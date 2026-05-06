import {Link} from "react-router-dom";
import {ReactComponent as TeamTBDSVG} from '../../assets/images/team-tbd.svg';
import { useEffect, useMemo, useState } from "react";

import { CustomTeam, ExtendedGame, ScheduleEvent, WindowFrame } from "../types/baseTypes";
import { getEventDetailsResponse, getISODateMultiplyOf10, getWindowResponse } from "../../utils/LoLEsportsAPI";

type Props = {
    scheduleEvent: ScheduleEvent;
    leagueLogoUrl?: string;
    teamRanks?: {
        blueRank?: number;
        redRank?: number;
    };
}

export function EventCard({ scheduleEvent, leagueLogoUrl, teamRanks }: Props) {
    const blueWins = scheduleEvent.match.teams[0].result ? scheduleEvent.match.teams[0].result.gameWins : 0
    const redWins = scheduleEvent.match.teams[1].result ? scheduleEvent.match.teams[1].result.gameWins : 0
    const bestOfCount = scheduleEvent.match.strategy.count
    const status = getEventCardStatus(scheduleEvent)
    const fallbackProgressSegments = useMemo(
        () => getSeriesProgressSegments(bestOfCount, blueWins, redWins),
        [bestOfCount, blueWins, redWins],
    )
    const [progressSegments, setProgressSegments] = useState<string[]>(fallbackProgressSegments)

    useEffect(() => {
        setProgressSegments(fallbackProgressSegments)
    }, [fallbackProgressSegments])

    useEffect(() => {
        let isCancelled = false

        async function syncSeriesProgressByGameOrder() {
            const shouldResolvePerGameOrder = bestOfCount > 1 && (blueWins + redWins) > 0
            if (!shouldResolvePerGameOrder) {
                setProgressSegments(fallbackProgressSegments)
                return
            }

            try {
                const eventDetailsResponse = await getEventDetailsResponse(scheduleEvent.match.id)
                const matchGames = eventDetailsResponse?.data?.data?.event?.match?.games as ExtendedGame[] | undefined

                if (!matchGames || matchGames.length === 0) {
                    if (!isCancelled) setProgressSegments(fallbackProgressSegments)
                    return
                }

                const completedGames = matchGames
                    .filter((game) => String(game.state).toLowerCase() === `completed`)
                    .sort((a, b) => a.number - b.number)

                if (completedGames.length === 0) {
                    if (!isCancelled) setProgressSegments(fallbackProgressSegments)
                    return
                }

                const winnerSideByGameNumber = new Map<number, `blue` | `red`>()

                await Promise.all(completedGames.map(async (game) => {
                    const winnerTeamId = await getWinnerTeamIdForGame(game.id, game.teams)
                    if (!winnerTeamId) return

                    const winnerTeam = game.teams.find((team) => team.id === winnerTeamId)
                    if (winnerTeam?.side === `blue` || winnerTeam?.side === `red`) {
                        winnerSideByGameNumber.set(game.number, winnerTeam.side)
                    }
                }))

                if (isCancelled) return

                const orderedCompletedSegmentsFallback = getSeriesProgressSegments(completedGames.length, blueWins, redWins)
                const orderedSegments: string[] = []

                completedGames.forEach((game, index) => {
                    const winnerSide = winnerSideByGameNumber.get(game.number)
                    if (winnerSide === `blue`) {
                        orderedSegments.push(`blue`)
                        return
                    }
                    if (winnerSide === `red`) {
                        orderedSegments.push(`red`)
                        return
                    }
                    orderedSegments.push(orderedCompletedSegmentsFallback[index] || `pending`)
                })

                while (orderedSegments.length < Math.max(bestOfCount, 1)) {
                    orderedSegments.push(`pending`)
                }

                setProgressSegments(orderedSegments.slice(0, Math.max(bestOfCount, 1)))
            } catch (error) {
                console.error(error)
                if (!isCancelled) setProgressSegments(fallbackProgressSegments)
            }
        }

        syncSeriesProgressByGameOrder()

        return () => {
            isCancelled = true
        }
    }, [
        scheduleEvent.match.id,
        bestOfCount,
        blueWins,
        redWins,
        fallbackProgressSegments,
    ])

    return (
        <Link to={`live/${scheduleEvent.match.id}`}>
            <div className="live-game-card schedule-event-card">
                <div className="schedule-event-card-meta">
                    <h3 className="live-game-card-league-title">
                        {leagueLogoUrl ? (
                            <img className="live-game-card-league-logo" src={leagueLogoUrl} alt={`${scheduleEvent.league.name} logo`} />
                        ) : null}
                        <span>{scheduleEvent.league.name} - {scheduleEvent.blockName}</span>
                    </h3>
                    <span className={`schedule-event-status-badge ${status.className}`}>{status.label}</span>
                </div>
                <h4 className="schedule-event-time">
                    <span>
                        {new Date(scheduleEvent.startTime).toLocaleTimeString([], {year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit'})}
                    </span>
                </h4>
                <div className="live-game-card-content schedule-event-matchup">
                    <div className="live-game-card-team schedule-event-team">
                        {scheduleEvent.match.teams[0].code === "TBD" ? (<TeamTBDSVG className="live-game-card-team-image"/>) : (<img className="live-game-card-team-image" src={scheduleEvent.match.teams[0].image} alt={scheduleEvent.match.teams[0].name}/>) }
                        <span className="schedule-event-team-name-wrap">
                            {teamRanks && teamRanks.blueRank ? <span className="schedule-event-rank-badge">#{teamRanks.blueRank}</span> : null}
                            <h4 className="schedule-event-team-name" title={scheduleEvent.match.teams[0].name}>
                                {scheduleEvent.match.teams[0].name}
                            </h4>
                        </span>
                        <span className="outcome schedule-event-outcome">
                            <p className={scheduleEvent.match.teams[0].result ? scheduleEvent.match.teams[0].result.outcome : ''}>
                                {scheduleEvent.match.teams[0].result ? scheduleEvent.match.teams[0].result.outcome : null}
                            </p>
                        </span>
                        <span className="schedule-event-record-wrap">
                            <p className="schedule-event-record">
                                {scheduleEvent.match.teams[0].record ? `${scheduleEvent.match.teams[0].record.wins} - ${scheduleEvent.match.teams[0].record.losses}` : null}
                            </p>
                        </span>
                    </div>

                    <div className="game-card-versus schedule-event-versus">
                        <span className="schedule-event-bo">BO{scheduleEvent.match.strategy.count}</span>
                        <span className="schedule-event-series-score-wrap">
                            <p className="schedule-event-series-score">
                                {scheduleEvent.match.teams[0].result && scheduleEvent.match.teams[1].result ? `${scheduleEvent.match.teams[0].result.gameWins} - ${scheduleEvent.match.teams[1].result.gameWins}` : null}
                            </p>
                        </span>
                        <h1>VS</h1>
                        <div
                            className="schedule-event-series-progress"
                            aria-label={`series progress ${blueWins} to ${redWins}`}
                            style={{ gridTemplateColumns: `repeat(${progressSegments.length}, 1fr)` }}
                        >
                            {progressSegments.map((segment, index) => (
                                <span key={`${scheduleEvent.match.id}_segment_${index}`} className={`schedule-event-series-segment ${segment}`} />
                            ))}
                        </div>
                    </div>

                    <div className="live-game-card-team schedule-event-team">
                        {scheduleEvent.match.teams[1].code === "TBD" ? (<TeamTBDSVG className="live-game-card-team-image"/>) : (<img className="live-game-card-team-image" src={scheduleEvent.match.teams[1].image} alt={scheduleEvent.match.teams[1].name}/>) }
                        <span className="schedule-event-team-name-wrap">
                            {teamRanks && teamRanks.redRank ? <span className="schedule-event-rank-badge">#{teamRanks.redRank}</span> : null}
                            <h4 className="schedule-event-team-name" title={scheduleEvent.match.teams[1].name}>
                                {scheduleEvent.match.teams[1].name}
                            </h4>
                        </span>
                        <span className="outcome schedule-event-outcome">
                            <p className={scheduleEvent.match.teams[1].result ? scheduleEvent.match.teams[1].result.outcome : ''}>
                                {scheduleEvent.match.teams[1].result ? scheduleEvent.match.teams[1].result.outcome : null}
                            </p>
                        </span>
                        <span className="schedule-event-record-wrap">
                            <p className="schedule-event-record">
                                {scheduleEvent.match.teams[1].record ? `${scheduleEvent.match.teams[1].record.wins} - ${scheduleEvent.match.teams[1].record.losses}` : null}
                            </p>
                        </span>
                    </div>
                </div>
            </div>
        </Link>
    );
}

function getEventCardStatus(scheduleEvent: ScheduleEvent) {
    const eventStartTime = new Date(scheduleEvent.startTime).getTime()
    const now = Date.now()
    const FUTURE_START_BUFFER_MS = 5 * 60 * 1000

    if (eventStartTime > now + FUTURE_START_BUFFER_MS && !hasMatchOutcome(scheduleEvent)) {
        return { label: "예정", className: "upcoming" }
    }
    if (scheduleEvent.state === "inProgress" || isLiveBySeries(scheduleEvent)) {
        return { label: "진행", className: "live" }
    }
    if (hasMatchOutcome(scheduleEvent) || scheduleEvent.state === "completed") {
        return { label: "종료", className: "final" }
    }
    return { label: "예정", className: "upcoming" }
}

function hasMatchOutcome(scheduleEvent: ScheduleEvent) {
    const blueOutcome = scheduleEvent.match.teams[0].result ? scheduleEvent.match.teams[0].result.outcome : undefined
    const redOutcome = scheduleEvent.match.teams[1].result ? scheduleEvent.match.teams[1].result.outcome : undefined
    return Boolean(blueOutcome || redOutcome)
}

function isLiveBySeries(scheduleEvent: ScheduleEvent) {
    const blueResult = scheduleEvent.match.teams[0].result
    const redResult = scheduleEvent.match.teams[1].result
    const blueInSeries = Boolean(blueResult && blueResult.gameWins > 0 && !blueResult.outcome)
    const redInSeries = Boolean(redResult && redResult.gameWins > 0 && !redResult.outcome)
    return blueInSeries || redInSeries
}

function getSeriesProgressSegments(bestOfCount: number, blueWins: number, redWins: number) {
    const segmentCount = Math.max(bestOfCount, 1)
    const segments: string[] = []
    for (let i = 0; i < segmentCount; i++) {
        if (i < blueWins) {
            segments.push("blue")
        } else if (i < blueWins + redWins) {
            segments.push("red")
        } else {
            segments.push("pending")
        }
    }
    return segments
}

const LIVE_STATS_STARTING_TIME_STEP_MS = 10 * 1000
const COMPLETED_GAME_TAIL_LOOKAHEAD_MS = 4 * 60 * 60 * 1000
const COMPLETED_GAME_TAIL_SAFE_NOW_OFFSET_MS = 60 * 1000

async function getWinnerTeamIdForGame(gameId: string, gameTeams: CustomTeam[]): Promise<string | undefined> {
    try {
        const initialWindowResponse = await getWindowResponse(gameId)
        if (!initialWindowResponse || !initialWindowResponse.data) return undefined

        const initialFrames = initialWindowResponse.data.frames as WindowFrame[] | undefined
        if (!initialFrames || initialFrames.length === 0) return undefined

        const initialLastFrame = initialFrames[initialFrames.length - 1]
        const winnerFromInitialFrame = inferWinnerSide(initialLastFrame)
        if (winnerFromInitialFrame) {
            return gameTeams.find((team) => team.side === winnerFromInitialFrame)?.id
        }

        const completedGameTailStartingTime = getCompletedGameTailStartingTime(initialFrames[0].rfc460Timestamp)
        const tailWindowResponse = await getWindowResponse(gameId, completedGameTailStartingTime)
        const tailFrames = tailWindowResponse?.data?.frames as WindowFrame[] | undefined
        if (!tailFrames || tailFrames.length === 0) return undefined

        const tailLastFrame = tailFrames[tailFrames.length - 1]
        const winnerFromTailFrame = inferWinnerSide(tailLastFrame)
        if (!winnerFromTailFrame) return undefined

        return gameTeams.find((team) => team.side === winnerFromTailFrame)?.id
    } catch (error) {
        console.error(error)
        return undefined
    }
}

function inferWinnerSide(lastWindowFrame: WindowFrame): CustomTeam[`side`] | undefined {
    const blueInhibitors = Number(lastWindowFrame.blueTeam.inhibitors || 0)
    const redInhibitors = Number(lastWindowFrame.redTeam.inhibitors || 0)

    if (blueInhibitors > 0 && redInhibitors === 0) return `blue`
    if (redInhibitors > 0 && blueInhibitors === 0) return `red`

    const blueGold = Number(lastWindowFrame.blueTeam.totalGold || 0)
    const redGold = Number(lastWindowFrame.redTeam.totalGold || 0)
    if (blueGold !== redGold) return blueGold > redGold ? `blue` : `red`

    const blueKills = Number(lastWindowFrame.blueTeam.totalKills || 0)
    const redKills = Number(lastWindowFrame.redTeam.totalKills || 0)
    if (blueKills !== redKills) return blueKills > redKills ? `blue` : `red`

    return undefined
}

function getCompletedGameTailStartingTime(firstWindowTimestamp: string | Date | undefined) {
    const firstWindowTimestampValue = getTimestampValue(firstWindowTimestamp)
    if (firstWindowTimestampValue === 0) return getISODateMultiplyOf10()

    const fourHoursAfterStartTimestampValue = firstWindowTimestampValue + COMPLETED_GAME_TAIL_LOOKAHEAD_MS
    const safeNowTimestampValue = Date.now() - COMPLETED_GAME_TAIL_SAFE_NOW_OFFSET_MS
    const completedGameTailTimestampValue = alignTimestampToLiveStatsStep(
        Math.min(fourHoursAfterStartTimestampValue, safeNowTimestampValue),
    )
    if (completedGameTailTimestampValue === 0) return getISODateMultiplyOf10()

    return new Date(completedGameTailTimestampValue).toISOString()
}

function getTimestampValue(timestamp: string | Date | undefined) {
    if (!timestamp) return 0
    const value = new Date(timestamp).getTime()
    return Number.isFinite(value) ? value : 0
}

function alignTimestampToLiveStatsStep(timestampValue: number) {
    if (!Number.isFinite(timestampValue) || timestampValue <= 0) return 0
    return timestampValue - (timestampValue % LIVE_STATS_STARTING_TIME_STEP_MS)
}
