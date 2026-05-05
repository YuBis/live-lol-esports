import './styles/playerStatusStyle.css'
import '../Schedule/styles/scheduleStyle.css'

import { GameDetails } from "./GameDetails"
import { MiniHealthBar } from "./MiniHealthBar";
import { ChangeEvent, useEffect, useState } from "react";
import { EventDetails, GameMetadata, Record, TeamStats, WindowFrame, WindowParticipant, ExtendedVod } from "../types/baseTypes";

import { ReactComponent as TowerSVG } from '../../assets/images/tower.svg';
import { ReactComponent as BaronSVG } from '../../assets/images/baron.svg';
import { ReactComponent as KillSVG } from '../../assets/images/kill.svg';
import { ReactComponent as InhibitorSVG } from '../../assets/images/inhibitor.svg';
import { ReactComponent as TeamTBDSVG } from '../../assets/images/team-tbd.svg';
import HeraldIcon from '../../assets/images/herald-icon.svg';

import { ReactComponent as OceanDragonSVG } from '../../assets/images/dragon-ocean.svg';
import { ReactComponent as ChemtechDragonSVG } from '../../assets/images/dragon-chemtech.svg';
import { ReactComponent as HextechDragonSVG } from '../../assets/images/dragon-hextech.svg';
import { ReactComponent as InfernalDragonSVG } from '../../assets/images/dragon-infernal.svg';
import { ReactComponent as CloudDragonSVG } from '../../assets/images/dragon-cloud.svg';
import { ReactComponent as MountainDragonSVG } from '../../assets/images/dragon-mountain.svg';
import { ReactComponent as ElderDragonSVG } from '../../assets/images/dragon-elder.svg';

import { LiveAPIWatcher } from "./LiveAPIWatcher";
import { CHAMPIONS_URL, getFormattedPatchVersion } from '../../utils/LoLEsportsAPI';
import { BUILD_LABEL } from '../../utils/buildInfo';
import { TwitchEmbed, TwitchEmbedLayout } from 'twitch-player';
import { ChatToggler } from '../Navbar/ChatToggler';
import { StreamToggler } from '../Navbar/StreamToggler';

type Props = {
    firstWindowFrame: WindowFrame,
    gameIndex: number,
    gameMetadata: GameMetadata,
    eventDetails: EventDetails,
    records?: Record[],
    championNameMap: {
        [championId: string]: string;
    },
    inferredHeraldKillCounts?: { blue: number, red: number },
}

type ScoreboardLayoutMode = `classic` | `mirror`
const SCOREBOARD_LAYOUT_MODE_STORAGE_KEY = `scoreboardLayoutMode`

export function DisabledGame({ firstWindowFrame, gameMetadata, gameIndex, eventDetails, championNameMap, inferredHeraldKillCounts = { blue: 0, red: 0 } }: Props) {
    const [videoProvider, setVideoProvider] = useState<string>();
    const [videoParameter, setVideoParameter] = useState<string>();
    const [scoreboardLayoutMode, setScoreboardLayoutMode] = useState<ScoreboardLayoutMode>(() => {
        try {
            return localStorage.getItem(SCOREBOARD_LAYOUT_MODE_STORAGE_KEY) === `mirror` ? `mirror` : `classic`
        } catch {
            return `classic`
        }
    })
    const chatData = localStorage.getItem("chat");
    const chatEnabled = chatData ? chatData === `unmute` : false
    const streamData = localStorage.getItem("stream");
    const streamEnabled = streamData ? streamData === `unmute` : false

    useEffect(() => {
        try {
            localStorage.setItem(SCOREBOARD_LAYOUT_MODE_STORAGE_KEY, scoreboardLayoutMode)
        } catch {
            // Ignore storage errors and keep runtime mode only.
        }
    }, [scoreboardLayoutMode])

    useEffect(() => {
        const mirrorModeClassName = `mirror-scoreboard-mode`
        if (scoreboardLayoutMode === `mirror`) {
            document.body.classList.add(mirrorModeClassName)
        } else {
            document.body.classList.remove(mirrorModeClassName)
        }
        return () => {
            document.body.classList.remove(mirrorModeClassName)
        }
    }, [scoreboardLayoutMode])

    useEffect(() => {
        let icon = "🟡"
        document.title = `${icon} ${eventDetails.league.name} - ${blueTeam.name} vs. ${redTeam.name}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [eventDetails.league.name, eventDetails.match.teams]);

    let blueTeam = eventDetails.match.teams[0];
    let redTeam = eventDetails.match.teams[1];

    const auxBlueTeam = blueTeam

    /*
        Team side can remain inverted in some leagues even after frame checks,
        so we also validate by summoner/team naming.
    */
    const summonerName = gameMetadata.blueTeamMetadata.participantMetadata[0].summonerName.split(" ");

    if ((summonerName[0] && summonerName[0].startsWith(redTeam.code)) || gameMetadata.blueTeamMetadata.esportsTeamId !== blueTeam.id) { // Academy tags may include extra chars, so we only compare prefixes.
        blueTeam = redTeam;
        redTeam = auxBlueTeam;
    }

    const goldPercentage = getGoldPercentage(firstWindowFrame.blueTeam.totalGold, firstWindowFrame.redTeam.totalGold);
    let inGameTime = getInGameTime(firstWindowFrame.rfc460Timestamp, firstWindowFrame.rfc460Timestamp)
    const formattedPatchVersion = getFormattedPatchVersion(gameMetadata.patchVersion)
    const championsUrlWithPatchVersion = CHAMPIONS_URL.replace(`PATCH_VERSION`, formattedPatchVersion)

    const playerStatsRowHeaders = Array.from($(`.player-stats-row th`))
    playerStatsRowHeaders.forEach((playerStatsRowHeader) => {
        const $playerStatsRowHeader = $(playerStatsRowHeader)
        $playerStatsRowHeader.prop(`onclick`, null).off(`click`)
        $playerStatsRowHeader.on(`click`, () => {
            const $playerStatsRow = $playerStatsRowHeader.closest(`tr.player-stats-row`)
            const $championStatsRowContainer = $playerStatsRow
                .next(`tr.champion-stats-row`)
                .find(`> td > span`)
                .first()
            const $chevron = $playerStatsRowHeader.find(`.chevron-down`)

            $championStatsRowContainer.stop(true, true).slideToggle()
            $chevron.toggleClass(`rotated`)
        })
    })

    function copyChampionNames() {
        let championNames: string[] = []
        gameMetadata.blueTeamMetadata.participantMetadata.forEach(participant => {
            championNames.push(getChampionDisplayName(participant.championId))
        })

        gameMetadata.redTeamMetadata.participantMetadata.forEach(participant => {
            championNames.push(getChampionDisplayName(participant.championId))
        })
        navigator.clipboard.writeText(championNames.join("\t"));
    }

    function getChampionDisplayName(championId: string) {
        return championNameMap[championId] || championId
    }

    function handleStreamChange(e: ChangeEvent<HTMLSelectElement>) {
        const optionSelected = e.target.selectedOptions[0];
        if (!optionSelected) return;

        setVideoParameter(optionSelected.getAttribute(`data-parameter`) || videoParameter)
        setVideoProvider(optionSelected.getAttribute(`data-provider`) || videoProvider)
        let videoPlayer = document.querySelector(`#video-player`)
        if (videoPlayer) {
            videoPlayer.removeAttribute(`added`)
        }
    }

    function capitalizeFirstLetter(string: string) {
        return string.charAt(0).toUpperCase() + string.slice(1);
    }

    const coStreamers: Array<ExtendedVod> = [
        {
            coStreamer: true,
            locale: `en-US`,
            offset: 0,
            parameter: `caedrel`,
            provider: `twitch`,
            mediaLocale: {
                englishName: `Caedrel`,
                translatedName: `Caedrel`,
                locale: `en-US`
            }
        },
        {
            coStreamer: true,
            locale: `en-US`,
            offset: 0,
            parameter: `doublelift`,
            provider: `twitch`,
            mediaLocale: {
                englishName: `Doublelift`,
                translatedName: `Doublelift`,
                locale: `en-US`
            }
        },
        {
            coStreamer: true,
            locale: `en-ES`,
            offset: 0,
            parameter: `ibai`,
            provider: `twitch`,
            mediaLocale: {
                englishName: `Ibai`,
                translatedName: `Ibai`,
                locale: `en-ES`
            }
        },
        {
            coStreamer: true,
            locale: `en-US`,
            offset: 0,
            parameter: `initialisecasts`,
            provider: `twitch`,
            mediaLocale: {
                englishName: `Initiliase`,
                translatedName: `Initiliase`,
                locale: `en-US`
            }
        },
        {
            coStreamer: true,
            locale: `en-US`,
            offset: 0,
            parameter: `iwdominate`,
            provider: `twitch`,
            mediaLocale: {
                englishName: `IWillDominate`,
                translatedName: `IWillDominate`,
                locale: `en-US`
            }
        },
        {
            coStreamer: true,
            locale: `en-CN`,
            offset: 0,
            parameter: `lpl`,
            provider: `huya`,
            mediaLocale: {
                englishName: `LPL - Huya`,
                translatedName: `LPL - Huya`,
                locale: `en-CN`
            }
        },
        {
            coStreamer: true,
            locale: `en-US`,
            offset: 0,
            parameter: `imls`,
            provider: `twitch`,
            mediaLocale: {
                englishName: `LS`,
                translatedName: `LS`,
                locale: `en-US`
            }
        },
        {
            coStreamer: true,
            locale: `en-US`,
            offset: 0,
            parameter: `nymaera_`,
            provider: `twitch`,
            mediaLocale: {
                englishName: `Nymaera`,
                translatedName: `Nymaera`,
                locale: `en-US`
            }
        },
        {
            coStreamer: true,
            locale: `en-US`,
            offset: 0,
            parameter: `loltyler1`,
            provider: `twitch`,
            mediaLocale: {
                englishName: `Tyler1`,
                translatedName: `Tyler1`,
                locale: `en-US`
            }
        },
        {
            coStreamer: true,
            locale: `en-US`,
            offset: 0,
            parameter: `yamatocannon`,
            provider: `twitch`,
            mediaLocale: {
                englishName: `YamatoCannon`,
                translatedName: `YamatoCannon`,
                locale: `en-US`
            }
        }]

    function getStreamDropdown(eventDetails: EventDetails) {
        let streamsOrVods: Array<ExtendedVod> = []
        let vods = []

        if (!eventDetails.streams || !eventDetails.streams.length) {
            if (eventDetails.match.games[gameIndex - 1] && eventDetails.match.games[gameIndex - 1].state === "completed") {
                return null
            } else {
                eventDetails.streams = []
            }
        }
        streamsOrVods = eventDetails.streams.sort((a, b) => b.coStreamer ? b.offset - a.offset : 1)
        coStreamers.forEach(streamer => {
            const foundStream = streamsOrVods.find(stream => stream.parameter === streamer.parameter)
            if (!foundStream) {
                streamsOrVods.push(streamer)
            }
        })

        let dropdown = streamsOrVods.map(stream => {
            let streamOffset = Math.round(stream.offset / 1000 / 60 * -1)
            let delayString = streamOffset > 1 ? `~${streamOffset} minutes` : `<1 minute`
            let streamString = vods.length ? `VOD: ${capitalizeFirstLetter(stream.provider)}(${stream.locale})` : stream.coStreamer ? stream.mediaLocale.englishName : stream.provider === `twitch` ? `${capitalizeFirstLetter(stream.provider)}(${stream.locale}) - ${stream.parameter} - Delay: ${delayString}` : `${capitalizeFirstLetter(stream.provider)}(${stream.locale}) - Delay: ${delayString}`
            return <option key={`${stream.provider}_${stream.parameter}_${stream.locale}`} value={stream.parameter} data-provider={stream.provider} data-parameter={stream.parameter}>{streamString}</option>
        })

        let videoPlayer = document.querySelector(`#video-player`)

        if (videoPlayer && (!videoPlayer.hasAttribute(`added`) || (vods.length && videoParameter !== streamsOrVods[0].parameter))) {
            setVideoParameter(streamsOrVods[0].parameter)
            setVideoProvider(streamsOrVods[0].provider)
            videoPlayer.removeAttribute(`added`)
            getVideoPlayer(streamsOrVods[0].parameter)
        }

        return (<select id="streamDropdown" className='footer-notes' onChange={handleStreamChange}>{dropdown}</select>)
    }

    function getVideoPlayer(newParameter?: string) {
        let parameter = newParameter || videoParameter
        let videoPlayer = document.querySelector(`#video-player`)
        if (!parameter || !videoProvider) return
        if (videoPlayer && !videoPlayer.hasAttribute(`added`)) {
            videoPlayer.setAttribute(`added`, `true`)
            if (videoProvider === "youtube") {
                videoPlayer.innerHTML = `
                <iframe
                    width="100%"
                    height="100%"
                    src="https://www.youtube.com/embed/${parameter}?autoplay=1"
                    frameBorder="0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    title="Embedded youtube"
                    </iframe>`

                if (chatEnabled) {
                    videoPlayer.innerHTML += `<iframe width="350px" height="500px" src="https://www.youtube.com/live_chat?v=${parameter}" ></iframe>`
                }

            } else if (videoProvider === "twitch") {
                videoPlayer.innerHTML = ``
                new TwitchEmbed(`video-player`, {
                    width: `100%`,
                    height: `100%`,
                    channel: parameter,
                    layout: chatEnabled ? TwitchEmbedLayout.VIDEO_WITH_CHAT : TwitchEmbedLayout.VIDEO,
                });
            } else if (videoProvider === "huya") {
                videoPlayer.innerHTML =
                    `<iframe width="100%" height="100%"  frameborder="0" scrolling="no" src="https://liveshare.huya.com/iframe/lpl"></iframe>`
            } else if (videoProvider === "afreecatv") {
                videoPlayer.innerHTML =
                    `<iframe src="https://play.afreecatv.com/${parameter}" width="100%" height="100%" frameborder="0" allowfullscreen></iframe>`
            }
        }
    }

    return (
        <div className={`status-live-game-card ${scoreboardLayoutMode === `mirror` ? `status-live-game-card-mirror-mode` : ``}`}>
            <GameDetails eventDetails={eventDetails} gameIndex={gameIndex} />
            <div className="status-live-game-card-content">
                {/* {eventDetails ? (<h3>{eventDetails?.league.name}</h3>) : null} */}
                <div className="live-game-stats-header">
                    <div className="live-game-stats-header-team-images">
                        <div className="live-game-card-team">
                            {blueTeam.code === "TBD" ? (<TeamTBDSVG className="live-game-card-team-image" />) : (<img className="live-game-card-team-image" src={blueTeam.image} alt={blueTeam.name} />)}
                            <span>
                                <h4>
                                    {blueTeam.name}
                                </h4>
                            </span>
                            <span className='outcome'>
                                {/* {outcome ? (<p className={outcome[0].outcome}>
                                    {outcome[0].outcome}
                                </p>) : null} */}
                            </span>
                        </div>
                        <h1>
                            <div className="gamestate-bg-game-disabled">데이터 수집 중</div>
                            <div>{inGameTime}</div>
                            <div className="live-game-kill-score">
                                <span className="blue-team-kills">{firstWindowFrame.blueTeam.totalKills}</span>
                                <KillSVG className="live-game-kill-score-icon" />
                                <span className="red-team-kills">{firstWindowFrame.redTeam.totalKills}</span>
                            </div>
                        </h1>
                        <div className="live-game-card-team">
                            {redTeam.code === "TBD" ? (<TeamTBDSVG className="live-game-card-team-image" />) : (<img className="live-game-card-team-image" src={redTeam.image} alt={redTeam.name} />)}
                            <span>
                                <h4>
                                    {redTeam.name}
                                </h4>
                            </span>
                            <span className='outcome'>
                                {/* {outcome ? (<p className={outcome[1].outcome}>
                                    {outcome[1].outcome}
                                </p>) : null} */}
                            </span>
                        </div>
                    </div>
                    <div className="live-game-stats-header-status">
                        {HeaderStats(firstWindowFrame.blueTeam, 'blue-team', inferredHeraldKillCounts.blue)}
                        {HeaderStats(firstWindowFrame.redTeam, 'red-team', inferredHeraldKillCounts.red)}
                    </div>
                    <div className="live-game-stats-header-gold">
                        <div className="blue-team" style={{ flex: goldPercentage.goldBluePercentage }} />
                        <div className="red-team" style={{ flex: goldPercentage.goldRedPercentage }} />
                    </div>
                    <div className="live-game-stats-header-dragons">
                        <div className="blue-team">
                            {firstWindowFrame.blueTeam.dragons.map((dragon, i) => (
                                getDragonSVG(dragon, 'blue', i)
                            ))}
                        </div>
                        <div className="red-team">

                            {firstWindowFrame.redTeam.dragons.slice().reverse().map((dragon, i) => (
                                getDragonSVG(dragon, 'red', i)
                            ))}
                        </div>
                    </div>
                </div>
                {scoreboardLayoutMode === `classic` ? (
                <div className="status-live-game-card-table-wrapper">
                    <table className="status-live-game-card-table">
                        <thead>
                            <tr key={blueTeam.code.toUpperCase()}>
                                <th className="table-top-row-champion" title="champion/team">
                                    <span>{blueTeam.code.toUpperCase()}</span>
                                </th>
                                <th className="table-top-row-vida" title="life">
                                    <span>체력</span>
                                </th>
                                <th className="table-top-row-items" title="items">
                                    <span>아이템</span>
                                </th>
                                <th className="table-top-row" title="creep score">
                                    <span>CS</span>
                                </th>
                                <th className="table-top-row player-stats-kda" title="kills">
                                    <span>K</span>
                                </th>
                                <th className="table-top-row player-stats-kda" title="kills">
                                    <span>D</span>
                                </th>
                                <th className="table-top-row player-stats-kda" title="kills">
                                    <span>A</span>
                                </th>
                                <th className="table-top-row" title="gold">
                                    <span>골드</span>
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {firstWindowFrame.blueTeam.participants.map((player: WindowParticipant, index) => {
                                let goldDifference = getGoldDifference(player, firstWindowFrame);
                                // let championDetails = lastDetailsFrame.participants[index]
                                return [(
                                    <tr className="player-stats-row" key={`${gameIndex}_${championsUrlWithPatchVersion}${gameMetadata.blueTeamMetadata.participantMetadata[player.participantId - 1].championId}`}>
                                        <th>
                                            <div className="player-champion-info">
                                                <div className='player-champion-wrapper'>
                                                    <img src={`${championsUrlWithPatchVersion}${gameMetadata.blueTeamMetadata.participantMetadata[player.participantId - 1].championId}.png`} alt="" className='player-champion' onError={({ currentTarget }) => { currentTarget.style.display = `none` }} />
                                                    <TeamTBDSVG className='player-champion' />
                                                    <span className=" player-champion-info-level">{player.level}</span>
                                                </div>
                                                <div className=" player-champion-info-name">
                                                    <span>{gameMetadata.blueTeamMetadata.participantMetadata[player.participantId - 1].summonerName}</span>
                                                    <span
                                                        className=" player-card-player-name">{getChampionDisplayName(gameMetadata.blueTeamMetadata.participantMetadata[player.participantId - 1].championId)}</span>
                                                </div>
                                            </div>
                                        </th>
                                        <td>
                                            <MiniHealthBar currentHealth={player.currentHealth} maxHealth={player.maxHealth} />
                                        </td>
                                        <td>
                                            {/* <ItemsDisplay participantId={player.participantId - 1} lastFrame={lastDetailsFrame} items={items} patchVersion={formattedPatchVersion} /> */}
                                        </td>
                                        <td>
                                            <div className=" player-stats">{player.creepScore}</div>
                                        </td>
                                        <td>
                                            <div className=" player-stats player-stats-kda">{player.kills}</div>
                                        </td>
                                        <td>
                                            <div className=" player-stats player-stats-kda">{player.deaths}</div>
                                        </td>
                                        <td>
                                            <div className=" player-stats player-stats-kda">{player.assists}</div>
                                        </td>
                                        <td>
                                            <div className="player-stats player-stats-gold">
                                                <span>{Number(player.totalGold).toLocaleString('en-us')}</span>
                                                <span className={`player-stats-gold-diff ${goldDifference > 0 ? `player-gold-positive` : goldDifference < 0 ? `player-gold-negative` : ``}`}>
                                                    {getFormattedGoldDifference(goldDifference)}
                                                </span>
                                            </div>
                                        </td>
                                    </tr>
                                ), (
                                    <tr key={`${gameIndex}_${championsUrlWithPatchVersion}${gameMetadata.blueTeamMetadata.participantMetadata[player.participantId - 1].championId}_stats`} className='champion-stats-row'>
                                        <td colSpan={8}>
                                            <span>
                                                {/* {getFormattedChampionStats(championDetails, runes)} */}
                                            </span>
                                        </td>
                                    </tr>
                                )]
                            })}
                        </tbody>
                    </table>

                    <table className="status-live-game-card-table">
                        <thead>
                            <tr key={redTeam.code.toUpperCase()}>
                                <th className="table-top-row-champion" title="champion/team">
                                    <span>{redTeam.code.toUpperCase()}</span>
                                </th>
                                <th className="table-top-row-vida" title="life">
                                    <span>체력</span>
                                </th>
                                <th className="table-top-row-items" title="items">
                                    <span>아이템</span>
                                </th>
                                <th className="table-top-row" title="creep score">
                                    <span>CS</span>
                                </th>
                                <th className="table-top-row player-stats-kda" title="kills">
                                    <span>K</span>
                                </th>
                                <th className="table-top-row player-stats-kda" title="kills">
                                    <span>D</span>
                                </th>
                                <th className="table-top-row player-stats-kda" title="kills">
                                    <span>A</span>
                                </th>
                                <th className="table-top-row" title="gold">
                                    <span>골드</span>
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {firstWindowFrame.redTeam.participants.map((player: WindowParticipant, index) => {
                                let goldDifference = getGoldDifference(player, firstWindowFrame);
                                // let championDetails = lastDetailsFrame.participants[index + 5]

                                return [(
                                    <tr className="player-stats-row" key={`${gameIndex}_${championsUrlWithPatchVersion}${gameMetadata.redTeamMetadata.participantMetadata[player.participantId - 6].championId}`}>
                                        <th>
                                            <div className="player-champion-info">
                                                <div className='player-champion-wrapper'>
                                                    <img src={`${championsUrlWithPatchVersion}${gameMetadata.redTeamMetadata.participantMetadata[player.participantId - 6].championId}.png`} alt="" className='player-champion' onError={({ currentTarget }) => { currentTarget.style.display = `none` }} />
                                                    <TeamTBDSVG className='player-champion' />
                                                    <span className=" player-champion-info-level">{player.level}</span>
                                                </div>
                                                <div className=" player-champion-info-name">
                                                    <span>{gameMetadata.redTeamMetadata.participantMetadata[player.participantId - 6].summonerName}</span>
                                                    <span className=" player-card-player-name">{getChampionDisplayName(gameMetadata.redTeamMetadata.participantMetadata[player.participantId - 6].championId)}</span>
                                                </div>
                                            </div>
                                        </th>
                                        <td>
                                            <MiniHealthBar currentHealth={player.currentHealth} maxHealth={player.maxHealth} />
                                        </td>
                                        <td>
                                            {/* <ItemsDisplay participantId={player.participantId - 1} lastFrame={lastDetailsFrame} items={items} patchVersion={formattedPatchVersion} /> */}
                                        </td>
                                        <td>
                                            <div className=" player-stats">{player.creepScore}</div>
                                        </td>
                                        <td>
                                            <div className=" player-stats player-stats-kda">{player.kills}</div>
                                        </td>
                                        <td>
                                            <div className=" player-stats player-stats-kda">{player.deaths}</div>
                                        </td>
                                        <td>
                                            <div className=" player-stats player-stats-kda">{player.assists}</div>
                                        </td>
                                        <td>
                                            <div className="player-stats player-stats-gold">
                                                <span>{Number(player.totalGold).toLocaleString('en-us')}</span>
                                                <span className={`player-stats-gold-diff ${goldDifference > 0 ? `player-gold-positive` : goldDifference < 0 ? `player-gold-negative` : ``}`}>
                                                    {getFormattedGoldDifference(goldDifference)}
                                                </span>
                                            </div>
                                        </td>
                                    </tr>
                                ), (
                                    <tr key={`${gameIndex}_${championsUrlWithPatchVersion}${gameMetadata.redTeamMetadata.participantMetadata[player.participantId - 6].championId}_stats`} className='champion-stats-row'>
                                        <td colSpan={8}>
                                            <span>
                                                {/* {getFormattedChampionStats(championDetails, runes)} */}
                                            </span>
                                        </td>
                                    </tr>
                                )]
                            })}
                        </tbody>
                    </table>
                </div>
                ) : (
                <div className="status-live-game-card-table-wrapper status-live-game-card-table-wrapper-mirror">
                    <table className="status-live-game-card-table status-live-game-card-table-mirror">
                        <thead>
                            <tr>
                                <th className="mirror-col-items">아이템</th>
                                <th className="mirror-col-health">체력</th>
                                <th className="mirror-col-team mirror-col-team-left">{blueTeam.code.toUpperCase()}</th>
                                <th className="mirror-col-kda">K</th>
                                <th className="mirror-col-kda">D</th>
                                <th className="mirror-col-kda">A</th>
                                <th className="mirror-col-cs">CS</th>
                                <th className="mirror-col-gold">골드차</th>
                                <th className="mirror-col-cs">CS</th>
                                <th className="mirror-col-kda">K</th>
                                <th className="mirror-col-kda">D</th>
                                <th className="mirror-col-kda">A</th>
                                <th className="mirror-col-team mirror-col-team-right">{redTeam.code.toUpperCase()}</th>
                                <th className="mirror-col-health">체력</th>
                                <th className="mirror-col-items">아이템</th>
                            </tr>
                        </thead>
                        <tbody>
                            {firstWindowFrame.blueTeam.participants.map((bluePlayer: WindowParticipant, index) => {
                                const redPlayer = firstWindowFrame.redTeam.participants[index]
                                const blueMetadata = gameMetadata.blueTeamMetadata.participantMetadata[index]
                                const redMetadata = gameMetadata.redTeamMetadata.participantMetadata[index]
                                if (!bluePlayer || !redPlayer || !blueMetadata || !redMetadata) return null

                                const rowGoldLead = bluePlayer.totalGold - redPlayer.totalGold
                                const rowGoldLeadColorClass = rowGoldLead > 0 ? `gold-advantage-blue` : rowGoldLead < 0 ? `gold-advantage-red` : `gold-advantage-neutral`
                                const rowGoldLeadMarker = getGoldLeadSymbol(rowGoldLead)
                                const rowGoldLeadSymbolAlignmentClass = rowGoldLead > 0 ? `mirror-row-gold-symbol-left` : rowGoldLead < 0 ? `mirror-row-gold-symbol-right` : ``
                                const rowGoldLeadValue = Number(Math.abs(rowGoldLead)).toLocaleString(`en-us`)

                                return (
                                    <tr className="mirror-player-row" key={`mirror_disabled_${gameIndex}_${bluePlayer.participantId}_${redPlayer.participantId}`}>
                                        <td>
                                            <div className="player-stats-items" />
                                        </td>
                                        <td>
                                            <MiniHealthBar currentHealth={bluePlayer.currentHealth} maxHealth={bluePlayer.maxHealth} />
                                        </td>
                                        <th className="mirror-player-cell mirror-player-cell-left">
                                            <div className="player-champion-info mirror-player-champion-info-left">
                                                <div className=" player-champion-info-name mirror-player-name-left">
                                                    <span>{blueMetadata.summonerName}</span>
                                                    <span className=" player-card-player-name">{getChampionDisplayName(blueMetadata.championId)}</span>
                                                </div>
                                                <div className='player-champion-wrapper'>
                                                    <img src={`${championsUrlWithPatchVersion}${blueMetadata.championId}.png`} alt="" className='player-champion' onError={({ currentTarget }) => { currentTarget.style.display = `none` }} />
                                                    <TeamTBDSVG className='player-champion' />
                                                    <span className=" player-champion-info-level">{bluePlayer.level}</span>
                                                </div>
                                            </div>
                                        </th>
                                        <td><div className=" player-stats player-stats-kda">{bluePlayer.kills}</div></td>
                                        <td><div className=" player-stats player-stats-kda">{bluePlayer.deaths}</div></td>
                                        <td><div className=" player-stats player-stats-kda">{bluePlayer.assists}</div></td>
                                        <td><div className=" player-stats">{bluePlayer.creepScore}</div></td>
                                        <td className="mirror-row-gold-cell">
                                            <div className={`mirror-row-gold-diff ${rowGoldLeadColorClass}`}>
                                                {rowGoldLeadMarker ? <span className={`mirror-row-gold-symbol ${rowGoldLeadSymbolAlignmentClass}`}>{rowGoldLeadMarker}</span> : null}
                                                <span className="mirror-row-gold-value">{rowGoldLeadValue}</span>
                                            </div>
                                        </td>
                                        <td><div className=" player-stats">{redPlayer.creepScore}</div></td>
                                        <td><div className=" player-stats player-stats-kda">{redPlayer.kills}</div></td>
                                        <td><div className=" player-stats player-stats-kda">{redPlayer.deaths}</div></td>
                                        <td><div className=" player-stats player-stats-kda">{redPlayer.assists}</div></td>
                                        <th className="mirror-player-cell mirror-player-cell-right">
                                            <div className="player-champion-info mirror-player-champion-info-right">
                                                <div className='player-champion-wrapper'>
                                                    <img src={`${championsUrlWithPatchVersion}${redMetadata.championId}.png`} alt="" className='player-champion' onError={({ currentTarget }) => { currentTarget.style.display = `none` }} />
                                                    <TeamTBDSVG className='player-champion' />
                                                    <span className=" player-champion-info-level">{redPlayer.level}</span>
                                                </div>
                                                <div className=" player-champion-info-name mirror-player-name-right">
                                                    <span>{redMetadata.summonerName}</span>
                                                    <span className=" player-card-player-name">{getChampionDisplayName(redMetadata.championId)}</span>
                                                </div>
                                            </div>
                                        </th>
                                        <td>
                                            <MiniHealthBar currentHealth={redPlayer.currentHealth} maxHealth={redPlayer.maxHealth} />
                                        </td>
                                        <td>
                                            <div className="player-stats-items" />
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
                )}
                <span className="footer-notes">
                    <a target="_blank" rel="noreferrer" href={`https://www.leagueoflegends.com/en-us/news/game-updates/patch-25-${gameMetadata.patchVersion.split(`.`)[1].length > 1 ? gameMetadata.patchVersion.split(`.`)[1] : "" + gameMetadata.patchVersion.split(`.`)[1]}-notes/`}>Patch Version: {gameMetadata.patchVersion}</a>
                </span>
                <span className="footer-notes">
                    <button type="button" className="copy-champion-names" onClick={copyChampionNames}>
                        Copy Champion Names
                    </button>
                </span>
                <span className="footer-notes build-revision" title={`Build revision: ${BUILD_LABEL}`}>
                    Revision: {BUILD_LABEL}
                </span>
                <button
                    type="button"
                    className={`footer-notes scoreboard-layout-toggle ${scoreboardLayoutMode === `mirror` ? `active` : ``}`}
                    onClick={() => setScoreboardLayoutMode((previousMode) => previousMode === `classic` ? `mirror` : `classic`)}
                >
                    {scoreboardLayoutMode === `classic` ? `레이아웃: 기본` : `레이아웃: 미러`}
                </button>
                {getStreamDropdown(eventDetails)}
                <div className='streamDiv'>
                    <span className='footer-notes'>Stream Enabled:</span>
                    <StreamToggler />
                </div>
                <div className='chatDiv'>
                    <span className='footer-notes'>Chat Enabled:</span>
                    <ChatToggler />
                </div>
                {streamEnabled ?
                    <div>
                        <div id="video-player" className={chatEnabled ? `chatEnabled` : ``}></div>
                        {getVideoPlayer()}
                    </div> : null}
            </div>
            <LiveAPIWatcher gameIndex={gameIndex} gameMetadata={gameMetadata} lastWindowFrame={firstWindowFrame} championsUrlWithPatchVersion={championsUrlWithPatchVersion} blueTeam={eventDetails.match.teams[0]} redTeam={eventDetails.match.teams[1]} />
        </div>
    );
}

function HeaderStats(teamStats: TeamStats, teamColor: string, inferredHeraldKills: number) {
    return (
        <div className={teamColor}>
            <div className="team-stats inhibitors">
                <InhibitorSVG />
                {teamStats.inhibitors}
            </div>
            <div className="team-stats barons">
                <BaronSVG />
                {teamStats.barons}
            </div>
            <div className="team-stats heralds">
                <span className={`team-stats-herald-icon-composite ${teamColor === `blue-team` ? `team-stats-herald-icon-composite-blue` : `team-stats-herald-icon-composite-red`}`}>
                    <img
                        src={HeraldIcon}
                        alt=""
                        className="team-stats-herald-icon-image"
                    />
                    <span className="team-stats-herald-icon-tint" aria-hidden="true" />
                </span>
                {inferredHeraldKills}
            </div>
            <div className="team-stats towers">
                <TowerSVG />
                {teamStats.towers}
            </div>
        </div>
    )
}

function getInGameTime(startTime: string, currentTime: string) {
    let startDate = new Date(startTime)
    let currentDate = new Date(currentTime)
    let seconds = Math.floor((currentDate.valueOf() - (startDate.valueOf())) / 1000)
    let minutes = Math.floor(seconds / 60);
    let hours = Math.floor(minutes / 60);
    let days = Math.floor(hours / 24);

    hours = hours - (days * 24);
    minutes = minutes - (days * 24 * 60) - (hours * 60);
    seconds = seconds - (days * 24 * 60 * 60) - (hours * 60 * 60) - (minutes * 60);
    let secondsString = seconds < 10 ? '0' + seconds : seconds

    return hours ? `${hours}:${minutes}:${secondsString}` : `${minutes}:${secondsString}`
}

function getGoldDifference(player: WindowParticipant, frame: WindowFrame) {
    if (6 > player.participantId) { // blue side
        const redPlayer = frame.redTeam.participants[player.participantId - 1];
        const goldResult = player.totalGold - redPlayer.totalGold;
        return goldResult;
    } else {
        const bluePlayer = frame.blueTeam.participants[player.participantId - 6];
        const goldResult = player.totalGold - bluePlayer.totalGold;
        return goldResult;
    }
}

function getDragonSVG(dragonName: string, teamColor: string, index: number) {
    let key = `${teamColor}_${index}_${dragonName}`
    switch (dragonName) {
        case "ocean": return <OceanDragonSVG className="dragon" key={key} />;
        case "hextech": return <HextechDragonSVG className="dragon" key={key} />;
        case "chemtech": return <ChemtechDragonSVG className="dragon" key={key} />;
        case "infernal": return <InfernalDragonSVG className="dragon" key={key} />
        case "cloud": return <CloudDragonSVG className="dragon" key={key} />
        case "mountain": return <MountainDragonSVG className="dragon" key={key} />
        case "elder": return <ElderDragonSVG className="dragon" key={key} />
    }
}

function getGoldLeadSymbol(goldLead: number) {
    if (goldLead > 0) return `\u25C0`
    if (goldLead < 0) return `\u25B6`
    return ``
}

function getGoldPercentage(goldBlue: number, goldRed: number) {
    const total = goldBlue + goldRed;
    if (total <= 0) {
        return {
            goldBluePercentage: 1,
            goldRedPercentage: 1,
        }
    }
    return {
        goldBluePercentage: goldBlue / total,
        goldRedPercentage: goldRed / total,
    }
}

function getFormattedGoldDifference(goldDifference: number) {
    const formattedDifference = Number(Math.abs(goldDifference)).toLocaleString("en-us")
    const sign = goldDifference > 0 ? `+` : goldDifference < 0 ? `-` : ``
    return `(${sign}${formattedDifference})`
}
