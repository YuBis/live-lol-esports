import './styles/playerStatusStyle.css'
import '../Schedule/styles/scheduleStyle.css'

import { GameDetails } from "./GameDetails"
import { MiniHealthBar } from "./MiniHealthBar";
import { ChangeEvent, useEffect, useRef, useState } from "react";
import { toast } from 'react-toastify';
import { DetailsFrame, EventDetails, GameMetadata, Item, ObjectiveTimerBackfillSeed, Outcome, Participant, Record, Result, TeamStats, WindowFrame, WindowParticipant, ExtendedVod, Rune, SlottedRune } from "../types/baseTypes";

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
import { ReactComponent as DragonObjectiveSVG } from '../../assets/images/dragon.svg';
import { ItemsDisplay } from "./ItemsDisplay";

import { LiveAPIWatcher } from "./LiveAPIWatcher";
import { CHAMPIONS_URL, getFormattedPatchVersion } from '../../utils/LoLEsportsAPI';
import { BUILD_LABEL } from '../../utils/buildInfo';
import { TwitchEmbed, TwitchEmbedLayout } from 'twitch-player';
import { ChatToggler } from '../Navbar/ChatToggler';
import { StreamToggler } from '../Navbar/StreamToggler';

type Props = {
    firstWindowFrame: WindowFrame,
    lastWindowFrame: WindowFrame,
    lastDetailsFrame: DetailsFrame,
    gameIndex: number,
    gameMetadata: GameMetadata,
    eventDetails: EventDetails,
    outcome: Array<Outcome>,
    records?: Record[],
    results?: Result[],
    items: Item[],
    runes: Rune[],
    championNameMap: {
        [championId: string]: string;
    },
    backfillStatus?: `idle` | `running` | `completed`,
    inferredHeraldKillCounts?: { blue: number, red: number },
    objectiveTimerBackfillSeed?: ObjectiveTimerBackfillSeed,
}

type TeamKey = `blue` | `red`
type BaronPowerPlaySnapshot = {
    baseLead: number,
    startedAtMs: number,
    lastValue: number,
    active: boolean,
}

enum GameState {
    in_game = "in game",
    paused = "game paused",
    finished = "game ended"
}

type ScoreboardLayoutMode = `classic` | `mirror`
const BARON_POWER_PLAY_DURATION_MS = 180 * 1000
const BARON_POWER_PLAY_BASELINE_GOLD = 1500
const BARON_FIRST_SPAWN_SECONDS = 20 * 60
const BARON_RESPAWN_SECONDS = 6 * 60
const HERALD_FIRST_SPAWN_SECONDS = 14 * 60
const DRAGON_FIRST_SPAWN_SECONDS = 5 * 60
const DRAGON_RESPAWN_SECONDS = 5 * 60
const ELDER_DRAGON_RESPAWN_SECONDS = 6 * 60
const ELDER_DRAGON_BUFF_DURATION_MS = 150 * 1000
const SCOREBOARD_LAYOUT_MODE_STORAGE_KEY = `scoreboardLayoutMode`
const FORCE_BARON_UI_PREVIEW = false

function getInitialScoreboardLayoutMode(): ScoreboardLayoutMode {
    try {
        return localStorage.getItem(SCOREBOARD_LAYOUT_MODE_STORAGE_KEY) === `mirror` ? `mirror` : `classic`
    } catch {
        return `classic`
    }
}

export function Game({ firstWindowFrame, lastWindowFrame, lastDetailsFrame, gameMetadata, gameIndex, eventDetails, outcome, results, items, runes, championNameMap, backfillStatus = `idle`, inferredHeraldKillCounts = { blue: 0, red: 0 }, objectiveTimerBackfillSeed }: Props) {
    const [gameState, setGameState] = useState<GameState>(GameState[lastWindowFrame.gameState as keyof typeof GameState]);
    const [videoProvider, setVideoProvider] = useState<string>();
    const [videoParameter, setVideoParameter] = useState<string>();
    const [scoreboardLayoutMode, setScoreboardLayoutMode] = useState<ScoreboardLayoutMode>(() => getInitialScoreboardLayoutMode())
    const [kdaFlashByCell, setKdaFlashByCell] = useState<{ [cellKey: string]: boolean }>({})
    const [deathTimerSecondsByParticipantId, setDeathTimerSecondsByParticipantId] = useState<{ [participantId: number]: number }>({})
    const [selectedRuneKeyByParticipantId, setSelectedRuneKeyByParticipantId] = useState<{ [participantId: number]: string }>({})
    const [mirrorExpandedParticipantIds, setMirrorExpandedParticipantIds] = useState<number[]>([])
    const [objectiveTimerTickMs, setObjectiveTimerTickMs] = useState<number>(Date.now())
    const [baronPowerPlayByTeam, setBaronPowerPlayByTeam] = useState<{ blue: number | null, red: number | null }>({ blue: null, red: null })
    const [baronPowerPlayRemainingSecondsByTeam, setBaronPowerPlayRemainingSecondsByTeam] = useState<{ blue: number | null, red: number | null }>({ blue: null, red: null })
    const [elderBuffRemainingSecondsByTeam, setElderBuffRemainingSecondsByTeam] = useState<{ blue: number | null, red: number | null }>({ blue: null, red: null })
    const previousKdaByParticipantIdRef = useRef<Map<number, { kills: number, deaths: number, assists: number }>>(new Map())
    const previousVitalsByParticipantIdRef = useRef<Map<number, { deaths: number, currentHealth: number }>>(new Map())
    const deathTimerEndAtMsByParticipantIdRef = useRef<Map<number, number>>(new Map())
    const flashClearTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
    const previousBaronKillCountsRef = useRef<{ blue: number, red: number }>({
        blue: Number(lastWindowFrame.blueTeam.barons || 0),
        red: Number(lastWindowFrame.redTeam.barons || 0),
    })
    const hasInitializedBaronKillCountsRef = useRef<boolean>(false)
    const hasInitializedDragonKillCountRef = useRef<boolean>(false)
    const baronPowerPlaySnapshotByTeamRef = useRef<{ blue: BaronPowerPlaySnapshot | null, red: BaronPowerPlaySnapshot | null }>({
        blue: null,
        red: null,
    })
    const previousDragonKillCountRef = useRef<number>(getDragonKillCount(lastWindowFrame))
    const previousDragonTypesByTeamRef = useRef<{ blue: string[], red: string[] }>({
        blue: getNormalizedDragonTypes(lastWindowFrame.blueTeam.dragons),
        red: getNormalizedDragonTypes(lastWindowFrame.redTeam.dragons),
    })
    const lastWindowFrameSyncedAtMsRef = useRef<number>(Date.now())
    const elderBuffEndAtMsByTeamRef = useRef<{ blue: number | null, red: number | null }>({
        blue: null,
        red: null,
    })
    const hasAppliedObjectiveTimerBackfillRef = useRef<boolean>(false)
    const lastBaronKillTimestampMsRef = useRef<number | null>(null)
    const lastDragonKillTimestampMsRef = useRef<number | null>(null)
    const lastProcessedObjectiveFrameTimestampMsRef = useRef<number | null>(null)
    const chatData = localStorage.getItem("chat");
    const chatEnabled = chatData ? chatData === `unmute` : false
    const streamData = localStorage.getItem("stream");
    const streamEnabled = streamData ? streamData === `unmute` : false

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
        try {
            localStorage.setItem(SCOREBOARD_LAYOUT_MODE_STORAGE_KEY, scoreboardLayoutMode)
        } catch {
            // Ignore storage errors and keep runtime mode only.
        }
    }, [scoreboardLayoutMode])

    useEffect(() => {
        const flashClearTimers = flashClearTimersRef.current
        return () => {
            flashClearTimers.forEach((timerId) => clearTimeout(timerId))
            flashClearTimers.clear()
        }
    }, [])

    useEffect(() => {
        const frameTimestampMs = Date.parse(lastWindowFrame.rfc460Timestamp)
        if (!Number.isFinite(frameTimestampMs)) return
        const participantsById = new Map<number, WindowParticipant>(
            [...lastWindowFrame.blueTeam.participants, ...lastWindowFrame.redTeam.participants]
                .map((participant) => [participant.participantId, participant]),
        )

        const localElapsedSinceLastWindowMs = lastWindowFrame.gameState === `in_game`
            ? Math.max(0, objectiveTimerTickMs - lastWindowFrameSyncedAtMsRef.current)
            : 0
        const effectiveFrameTimestampMs = frameTimestampMs + localElapsedSinceLastWindowMs
        const nextDeathTimerSecondsByParticipantId: { [participantId: number]: number } = {}

        deathTimerEndAtMsByParticipantIdRef.current.forEach((deathTimerEndAtMs, participantId) => {
            const remainingMs = deathTimerEndAtMs - effectiveFrameTimestampMs
            if (remainingMs <= 0) {
                const participant = participantsById.get(participantId)
                // Keep showing at least 1s while the latest frame still reports dead.
                // This prevents the timer from disappearing during frame-sync gaps.
                if (participant && Number(participant.currentHealth) <= 0) {
                    nextDeathTimerSecondsByParticipantId[participantId] = 1
                    return
                }
                deathTimerEndAtMsByParticipantIdRef.current.delete(participantId)
                return
            }
            nextDeathTimerSecondsByParticipantId[participantId] = Math.ceil(remainingMs / 1000)
        })

        setDeathTimerSecondsByParticipantId((previousState) =>
            areNumericRecordValuesEqual(previousState, nextDeathTimerSecondsByParticipantId)
                ? previousState
                : nextDeathTimerSecondsByParticipantId
        )
    }, [
        objectiveTimerTickMs,
        lastWindowFrame.rfc460Timestamp,
        lastWindowFrame.gameState,
        lastWindowFrame.blueTeam.participants,
        lastWindowFrame.redTeam.participants,
    ])

    useEffect(() => {
        const objectiveTickerIntervalId = setInterval(() => {
            setObjectiveTimerTickMs(Date.now())
        }, 1000)

        return () => clearInterval(objectiveTickerIntervalId)
    }, [])

    useEffect(() => {
        lastWindowFrameSyncedAtMsRef.current = Date.now()
        setObjectiveTimerTickMs(Date.now())
    }, [lastWindowFrame.rfc460Timestamp])

    useEffect(() => {
        previousKdaByParticipantIdRef.current.clear()
        previousVitalsByParticipantIdRef.current.clear()
        deathTimerEndAtMsByParticipantIdRef.current.clear()
        setKdaFlashByCell({})
        setDeathTimerSecondsByParticipantId({})
        setSelectedRuneKeyByParticipantId({})
        setMirrorExpandedParticipantIds([])
        setBaronPowerPlayByTeam({ blue: null, red: null })
        setBaronPowerPlayRemainingSecondsByTeam({ blue: null, red: null })
        setElderBuffRemainingSecondsByTeam({ blue: null, red: null })
        previousBaronKillCountsRef.current = {
            blue: 0,
            red: 0,
        }
        hasInitializedBaronKillCountsRef.current = false
        previousDragonKillCountRef.current = 0
        previousDragonTypesByTeamRef.current = { blue: [], red: [] }
        hasInitializedDragonKillCountRef.current = false
        baronPowerPlaySnapshotByTeamRef.current = { blue: null, red: null }
        elderBuffEndAtMsByTeamRef.current = { blue: null, red: null }
        hasAppliedObjectiveTimerBackfillRef.current = false
        lastBaronKillTimestampMsRef.current = null
        lastDragonKillTimestampMsRef.current = null
        lastProcessedObjectiveFrameTimestampMsRef.current = null
    }, [gameIndex, firstWindowFrame.rfc460Timestamp])

    useEffect(() => {
        if (!objectiveTimerBackfillSeed || hasAppliedObjectiveTimerBackfillRef.current) return

        const frameTimestampMs = Date.parse(lastWindowFrame.rfc460Timestamp)
        if (!Number.isFinite(frameTimestampMs)) return

        lastBaronKillTimestampMsRef.current = objectiveTimerBackfillSeed.lastBaronKillTimestampMs
        lastDragonKillTimestampMsRef.current = objectiveTimerBackfillSeed.lastDragonKillTimestampMs

        const blueTeamLead = Number(lastWindowFrame.blueTeam.totalGold || 0) - Number(lastWindowFrame.redTeam.totalGold || 0)
        const redTeamLead = -blueTeamLead
        const nextPowerPlayByTeam: { blue: number | null, red: number | null } = { blue: null, red: null }
        const nextPowerPlayRemainingSecondsByTeam: { blue: number | null, red: number | null } = { blue: null, red: null }

        ;([`blue`, `red`] as TeamKey[]).forEach((teamKey) => {
            const seedSnapshot = objectiveTimerBackfillSeed.baronPowerPlaySnapshotByTeam[teamKey]
            if (!seedSnapshot) {
                baronPowerPlaySnapshotByTeamRef.current[teamKey] = null
                return
            }

            const elapsedMs = Math.max(0, frameTimestampMs - seedSnapshot.startedAtMs)
            if (elapsedMs >= BARON_POWER_PLAY_DURATION_MS) {
                baronPowerPlaySnapshotByTeamRef.current[teamKey] = null
                return
            }

            const currentLead = teamKey === `blue` ? blueTeamLead : redTeamLead
            const powerPlayValue = Math.round((currentLead - seedSnapshot.baseLead) + BARON_POWER_PLAY_BASELINE_GOLD)
            nextPowerPlayByTeam[teamKey] = powerPlayValue
            nextPowerPlayRemainingSecondsByTeam[teamKey] = Math.max(0, Math.ceil((BARON_POWER_PLAY_DURATION_MS - elapsedMs) / 1000))

            baronPowerPlaySnapshotByTeamRef.current[teamKey] = {
                baseLead: seedSnapshot.baseLead,
                startedAtMs: seedSnapshot.startedAtMs,
                lastValue: powerPlayValue,
                active: true,
            }
        })

        setBaronPowerPlayByTeam(nextPowerPlayByTeam)
        setBaronPowerPlayRemainingSecondsByTeam(nextPowerPlayRemainingSecondsByTeam)

        elderBuffEndAtMsByTeamRef.current = {
            blue: objectiveTimerBackfillSeed.elderBuffEndAtMsByTeam.blue,
            red: objectiveTimerBackfillSeed.elderBuffEndAtMsByTeam.red,
        }
        const nextElderBuffRemainingSecondsByTeam: { blue: number | null, red: number | null } = { blue: null, red: null }
        ;([`blue`, `red`] as TeamKey[]).forEach((teamKey) => {
            const elderBuffEndAtMs = elderBuffEndAtMsByTeamRef.current[teamKey]
            if (!elderBuffEndAtMs) return
            const remainingSeconds = Math.max(0, Math.ceil((elderBuffEndAtMs - frameTimestampMs) / 1000))
            if (remainingSeconds <= 0) {
                elderBuffEndAtMsByTeamRef.current[teamKey] = null
                return
            }
            nextElderBuffRemainingSecondsByTeam[teamKey] = remainingSeconds
        })
        setElderBuffRemainingSecondsByTeam(nextElderBuffRemainingSecondsByTeam)

        previousBaronKillCountsRef.current = {
            blue: Number(lastWindowFrame.blueTeam.barons || 0),
            red: Number(lastWindowFrame.redTeam.barons || 0),
        }
        previousDragonKillCountRef.current = getDragonKillCount(lastWindowFrame)
        previousDragonTypesByTeamRef.current = {
            blue: getNormalizedDragonTypes(lastWindowFrame.blueTeam.dragons),
            red: getNormalizedDragonTypes(lastWindowFrame.redTeam.dragons),
        }
        hasInitializedBaronKillCountsRef.current = true
        hasInitializedDragonKillCountRef.current = true
        hasAppliedObjectiveTimerBackfillRef.current = true
    }, [
        objectiveTimerBackfillSeed,
        lastWindowFrame,
        lastWindowFrame.rfc460Timestamp,
        lastWindowFrame.blueTeam.totalGold,
        lastWindowFrame.redTeam.totalGold,
        lastWindowFrame.blueTeam.barons,
        lastWindowFrame.redTeam.barons,
        lastWindowFrame.blueTeam.dragons,
        lastWindowFrame.redTeam.dragons,
    ])

    useEffect(() => {
        const frameTimestampMs = Date.parse(lastWindowFrame.rfc460Timestamp)
        if (!Number.isFinite(frameTimestampMs)) return
        if (lastProcessedObjectiveFrameTimestampMsRef.current === frameTimestampMs) return
        lastProcessedObjectiveFrameTimestampMsRef.current = frameTimestampMs

        const blueTeamGold = Number(lastWindowFrame.blueTeam.totalGold || 0)
        const redTeamGold = Number(lastWindowFrame.redTeam.totalGold || 0)
        const blueTeamLead = blueTeamGold - redTeamGold
        const redTeamLead = redTeamGold - blueTeamGold

        const currentBaronCounts = {
            blue: Number(lastWindowFrame.blueTeam.barons || 0),
            red: Number(lastWindowFrame.redTeam.barons || 0),
        }
        const currentDragonKillCount = (
            (Array.isArray(lastWindowFrame.blueTeam.dragons) ? lastWindowFrame.blueTeam.dragons.length : 0)
            + (Array.isArray(lastWindowFrame.redTeam.dragons) ? lastWindowFrame.redTeam.dragons.length : 0)
        )
        const currentDragonTypesByTeam = {
            blue: getNormalizedDragonTypes(lastWindowFrame.blueTeam.dragons),
            red: getNormalizedDragonTypes(lastWindowFrame.redTeam.dragons),
        }

        if (!hasInitializedBaronKillCountsRef.current || !hasInitializedDragonKillCountRef.current) {
            previousBaronKillCountsRef.current = currentBaronCounts
            previousDragonKillCountRef.current = currentDragonKillCount
            previousDragonTypesByTeamRef.current = {
                blue: [...currentDragonTypesByTeam.blue],
                red: [...currentDragonTypesByTeam.red],
            }
            hasInitializedBaronKillCountsRef.current = true
            hasInitializedDragonKillCountRef.current = true
            return
        }

        const previousBaronCounts = previousBaronKillCountsRef.current
        const previousDragonKillCount = previousDragonKillCountRef.current
        const previousDragonTypesByTeam = previousDragonTypesByTeamRef.current

        const blueBaronKillDetected = currentBaronCounts.blue > previousBaronCounts.blue
        const redBaronKillDetected = currentBaronCounts.red > previousBaronCounts.red
        const dragonKillDetected = currentDragonKillCount > previousDragonKillCount
        const blueAddedDragonTypes = getAddedDragonTypes(previousDragonTypesByTeam.blue, currentDragonTypesByTeam.blue)
        const redAddedDragonTypes = getAddedDragonTypes(previousDragonTypesByTeam.red, currentDragonTypesByTeam.red)
        const blueElderKillDetected = blueAddedDragonTypes.some(isElderDragonType)
        const redElderKillDetected = redAddedDragonTypes.some(isElderDragonType)
        if (blueBaronKillDetected || redBaronKillDetected) {
            lastBaronKillTimestampMsRef.current = frameTimestampMs
        }
        if (dragonKillDetected) {
            lastDragonKillTimestampMsRef.current = frameTimestampMs
        }
        if (blueElderKillDetected) {
            elderBuffEndAtMsByTeamRef.current.blue = frameTimestampMs + ELDER_DRAGON_BUFF_DURATION_MS
        }
        if (redElderKillDetected) {
            elderBuffEndAtMsByTeamRef.current.red = frameTimestampMs + ELDER_DRAGON_BUFF_DURATION_MS
        }

        if (blueBaronKillDetected) {
            baronPowerPlaySnapshotByTeamRef.current.blue = {
                baseLead: blueTeamLead,
                startedAtMs: frameTimestampMs,
                lastValue: 0,
                active: true,
            }
        }

        if (redBaronKillDetected) {
            baronPowerPlaySnapshotByTeamRef.current.red = {
                baseLead: redTeamLead,
                startedAtMs: frameTimestampMs,
                lastValue: 0,
                active: true,
            }
        }

        const nextPowerPlayByTeam: { blue: number | null, red: number | null } = { blue: null, red: null }
        const nextRemainingSecondsByTeam: { blue: number | null, red: number | null } = { blue: null, red: null }
        ;([`blue`, `red`] as TeamKey[]).forEach((teamKey) => {
            const snapshot = baronPowerPlaySnapshotByTeamRef.current[teamKey]
            if (!snapshot) return

            const elapsedMs = Math.max(0, frameTimestampMs - snapshot.startedAtMs)
            if (elapsedMs >= BARON_POWER_PLAY_DURATION_MS) {
                snapshot.active = false
                baronPowerPlaySnapshotByTeamRef.current[teamKey] = null
                return
            }

            const currentLead = teamKey === `blue` ? blueTeamLead : redTeamLead
            snapshot.lastValue = Math.round((currentLead - snapshot.baseLead) + BARON_POWER_PLAY_BASELINE_GOLD)
            nextPowerPlayByTeam[teamKey] = snapshot.lastValue
            nextRemainingSecondsByTeam[teamKey] = Math.max(0, Math.ceil((BARON_POWER_PLAY_DURATION_MS - elapsedMs) / 1000))
        })

        setBaronPowerPlayByTeam((previousState) => (
            previousState.blue === nextPowerPlayByTeam.blue
            && previousState.red === nextPowerPlayByTeam.red
        ) ? previousState : nextPowerPlayByTeam)
        setBaronPowerPlayRemainingSecondsByTeam((previousState) => (
            previousState.blue === nextRemainingSecondsByTeam.blue
            && previousState.red === nextRemainingSecondsByTeam.red
        ) ? previousState : nextRemainingSecondsByTeam)
        const nextElderBuffRemainingSecondsByTeam: { blue: number | null, red: number | null } = { blue: null, red: null }
        ;([`blue`, `red`] as TeamKey[]).forEach((teamKey) => {
            const elderBuffEndAtMs = elderBuffEndAtMsByTeamRef.current[teamKey]
            if (!elderBuffEndAtMs) return
            const remainingSeconds = Math.max(0, Math.ceil((elderBuffEndAtMs - frameTimestampMs) / 1000))
            if (remainingSeconds <= 0) {
                elderBuffEndAtMsByTeamRef.current[teamKey] = null
                return
            }
            nextElderBuffRemainingSecondsByTeam[teamKey] = remainingSeconds
        })
        setElderBuffRemainingSecondsByTeam((previousState) => (
            previousState.blue === nextElderBuffRemainingSecondsByTeam.blue
            && previousState.red === nextElderBuffRemainingSecondsByTeam.red
        ) ? previousState : nextElderBuffRemainingSecondsByTeam)

        previousBaronKillCountsRef.current = currentBaronCounts
        previousDragonKillCountRef.current = currentDragonKillCount
        previousDragonTypesByTeamRef.current = {
            blue: [...currentDragonTypesByTeam.blue],
            red: [...currentDragonTypesByTeam.red],
        }
    }, [
        lastWindowFrame.rfc460Timestamp,
        lastWindowFrame.blueTeam.totalGold,
        lastWindowFrame.redTeam.totalGold,
        lastWindowFrame.blueTeam.barons,
        lastWindowFrame.redTeam.barons,
        lastWindowFrame.blueTeam.dragons,
        lastWindowFrame.redTeam.dragons,
        lastWindowFrame.blueTeam.dragons.length,
        lastWindowFrame.redTeam.dragons.length,
    ])

    useEffect(() => {
        const frameTimestampMs = Date.parse(lastWindowFrame.rfc460Timestamp)
        if (!Number.isFinite(frameTimestampMs)) return

        const localElapsedSinceLastWindowMs = lastWindowFrame.gameState === `in_game`
            ? Math.max(0, objectiveTimerTickMs - lastWindowFrameSyncedAtMsRef.current)
            : 0
        const effectiveFrameTimestampMs = frameTimestampMs + localElapsedSinceLastWindowMs
        const blueTeamLead = Number(lastWindowFrame.blueTeam.totalGold || 0) - Number(lastWindowFrame.redTeam.totalGold || 0)
        const redTeamLead = -blueTeamLead

        const nextPowerPlayByTeam: { blue: number | null, red: number | null } = { blue: null, red: null }
        const nextRemainingSecondsByTeam: { blue: number | null, red: number | null } = { blue: null, red: null }
        ;([`blue`, `red`] as TeamKey[]).forEach((teamKey) => {
            const snapshot = baronPowerPlaySnapshotByTeamRef.current[teamKey]
            if (!snapshot) return

            const elapsedMs = Math.max(0, effectiveFrameTimestampMs - snapshot.startedAtMs)
            if (elapsedMs >= BARON_POWER_PLAY_DURATION_MS) {
                baronPowerPlaySnapshotByTeamRef.current[teamKey] = null
                return
            }

            const currentLead = teamKey === `blue` ? blueTeamLead : redTeamLead
            const powerPlayValue = Math.round((currentLead - snapshot.baseLead) + BARON_POWER_PLAY_BASELINE_GOLD)
            snapshot.lastValue = powerPlayValue
            nextPowerPlayByTeam[teamKey] = powerPlayValue
            nextRemainingSecondsByTeam[teamKey] = Math.max(0, Math.ceil((BARON_POWER_PLAY_DURATION_MS - elapsedMs) / 1000))
        })

        setBaronPowerPlayByTeam((previousState) => (
            previousState.blue === nextPowerPlayByTeam.blue
            && previousState.red === nextPowerPlayByTeam.red
        ) ? previousState : nextPowerPlayByTeam)
        setBaronPowerPlayRemainingSecondsByTeam((previousState) => (
            previousState.blue === nextRemainingSecondsByTeam.blue
            && previousState.red === nextRemainingSecondsByTeam.red
        ) ? previousState : nextRemainingSecondsByTeam)

        const nextElderBuffRemainingSecondsByTeam: { blue: number | null, red: number | null } = { blue: null, red: null }
        ;([`blue`, `red`] as TeamKey[]).forEach((teamKey) => {
            const elderBuffEndAtMs = elderBuffEndAtMsByTeamRef.current[teamKey]
            if (!elderBuffEndAtMs) return

            const remainingSeconds = Math.max(0, Math.ceil((elderBuffEndAtMs - effectiveFrameTimestampMs) / 1000))
            if (remainingSeconds <= 0) {
                elderBuffEndAtMsByTeamRef.current[teamKey] = null
                return
            }
            nextElderBuffRemainingSecondsByTeam[teamKey] = remainingSeconds
        })

        setElderBuffRemainingSecondsByTeam((previousState) => (
            previousState.blue === nextElderBuffRemainingSecondsByTeam.blue
            && previousState.red === nextElderBuffRemainingSecondsByTeam.red
        ) ? previousState : nextElderBuffRemainingSecondsByTeam)
    }, [
        objectiveTimerTickMs,
        lastWindowFrame.rfc460Timestamp,
        lastWindowFrame.gameState,
        lastWindowFrame.blueTeam.totalGold,
        lastWindowFrame.redTeam.totalGold,
    ])

    useEffect(() => {
        const flashCellKeys: string[] = []
        const participants = [
            ...lastWindowFrame.blueTeam.participants,
            ...lastWindowFrame.redTeam.participants,
        ]
        const frameTimestampMs = Date.parse(lastWindowFrame.rfc460Timestamp)
        const normalizedFrameTimestampMs = Number.isFinite(frameTimestampMs) ? frameTimestampMs : Date.now()
        const elapsedGameTimeSeconds = getElapsedGameTimeSeconds(firstWindowFrame.rfc460Timestamp, lastWindowFrame.rfc460Timestamp)

        participants.forEach((participant) => {
            let hasActiveDeathTimer = deathTimerEndAtMsByParticipantIdRef.current.has(participant.participantId)
            const previousVitals = previousVitalsByParticipantIdRef.current.get(participant.participantId)
            if (
                previousVitals
                && participant.deaths > previousVitals.deaths
            ) {
                const estimatedRespawnSeconds = getEstimatedRespawnSeconds(participant.level, elapsedGameTimeSeconds)
                deathTimerEndAtMsByParticipantIdRef.current.set(
                    participant.participantId,
                    normalizedFrameTimestampMs + estimatedRespawnSeconds * 1000,
                )
                hasActiveDeathTimer = true
            }

            if (participant.currentHealth <= 0 && !hasActiveDeathTimer) {
                // Refresh/reconnect can land mid-death without a detected death transition.
                // Seed an estimated timer so dead players do not appear without countdown.
                const estimatedRespawnSeconds = getEstimatedRespawnSeconds(participant.level, elapsedGameTimeSeconds)
                deathTimerEndAtMsByParticipantIdRef.current.set(
                    participant.participantId,
                    normalizedFrameTimestampMs + estimatedRespawnSeconds * 1000,
                )
            }

            if (participant.currentHealth > 0) {
                deathTimerEndAtMsByParticipantIdRef.current.delete(participant.participantId)
            }
            previousVitalsByParticipantIdRef.current.set(participant.participantId, {
                deaths: participant.deaths,
                currentHealth: participant.currentHealth,
            })

            const previousKda = previousKdaByParticipantIdRef.current.get(participant.participantId)
            if (previousKda) {
                if (participant.kills > previousKda.kills) {
                    flashCellKeys.push(`k_${participant.participantId}`)
                }
                if (participant.deaths > previousKda.deaths) {
                    flashCellKeys.push(`d_${participant.participantId}`)
                }
                if (participant.assists > previousKda.assists) {
                    flashCellKeys.push(`a_${participant.participantId}`)
                }
            }
            previousKdaByParticipantIdRef.current.set(participant.participantId, {
                kills: participant.kills,
                deaths: participant.deaths,
                assists: participant.assists,
            })
        })

        if (flashCellKeys.length === 0) return

        setKdaFlashByCell((previousState) => {
            const nextState = { ...previousState }
            flashCellKeys.forEach((cellKey) => {
                nextState[cellKey] = false
            })
            return nextState
        })

        requestAnimationFrame(() => {
            setKdaFlashByCell((previousState) => {
                const nextState = { ...previousState }
                flashCellKeys.forEach((cellKey) => {
                    nextState[cellKey] = true
                })
                return nextState
            })
        })

        flashCellKeys.forEach((cellKey) => {
            const existingTimerId = flashClearTimersRef.current.get(cellKey)
            if (existingTimerId) {
                clearTimeout(existingTimerId)
            }
            const timerId = setTimeout(() => {
                setKdaFlashByCell((previousState) => {
                    if (!previousState[cellKey]) return previousState
                    const nextState = { ...previousState }
                    delete nextState[cellKey]
                    return nextState
                })
                flashClearTimersRef.current.delete(cellKey)
            }, 2000)
            flashClearTimersRef.current.set(cellKey, timerId)
        })
    }, [
        firstWindowFrame.rfc460Timestamp,
        lastWindowFrame.rfc460Timestamp,
        lastWindowFrame.blueTeam.participants,
        lastWindowFrame.redTeam.participants,
    ])

    useEffect(() => {
        const currentGameState: GameState = GameState[lastWindowFrame.gameState as keyof typeof GameState]
        let icon = currentGameState === GameState.finished ? "\uD83D\uDD34" : currentGameState === GameState.paused ? "\uD83D\uDFE0" : "\uD83D\uDFE2"
        document.title = `${icon} ${eventDetails.league.name} - ${blueTeam.name} vs. ${redTeam.name}`;

        if (currentGameState !== gameState) {
            setGameState(currentGameState);

            if (currentGameState === GameState.in_game) {
                toast.success(`Game Resumed`, {
                    delay: 15000,
                    position: "top-right",
                    hideProgressBar: false,
                    closeOnClick: true,
                    pauseOnHover: false,
                    pauseOnFocusLoss: false,
                    draggable: true,
                    toastId: `gameStatus`,
                })
            } else if (currentGameState === GameState.finished) {
                toast.error(`Game Ended`, {
                    delay: 15000,
                    position: "top-right",
                    hideProgressBar: false,
                    closeOnClick: true,
                    pauseOnHover: false,
                    pauseOnFocusLoss: false,
                    draggable: true,
                    toastId: `gameStatus`,
                })
            } else {
                toast.warning(`Game Paused`, {
                    delay: 15000,
                    position: "top-right",
                    hideProgressBar: false,
                    closeOnClick: true,
                    pauseOnHover: false,
                    pauseOnFocusLoss: false,
                    draggable: true,
                    toastId: `gameStatus`,
                })
            }

        }

    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lastWindowFrame.gameState, gameState, eventDetails.league.name, eventDetails.match.teams]);

    let blueTeam = eventDetails.match.teams[0];
    let redTeam = eventDetails.match.teams[1];

    const auxBlueTeam = blueTeam

    /*
        Some leagues occasionally report swapped team sides in recent frames,
        We also verify by summoner tag as a fallback.
    */
    const summonerName = gameMetadata.blueTeamMetadata.participantMetadata[0].summonerName.split(" ");

    if ((summonerName[0] && summonerName[0].startsWith(redTeam.code)) || gameMetadata.blueTeamMetadata.esportsTeamId !== blueTeam.id) { // Only compare prefix because academy tags may differ from summoner naming.
        blueTeam = redTeam;
        redTeam = auxBlueTeam;
    }

    const goldPercentage = getGoldPercentage(lastWindowFrame.blueTeam.totalGold, lastWindowFrame.redTeam.totalGold);
    const goldLead = lastWindowFrame.blueTeam.totalGold - lastWindowFrame.redTeam.totalGold
    const goldLeadSymbol = getGoldLeadSymbol(goldLead)
    const formattedBlueTeamGold = formatTeamGoldInK(lastWindowFrame.blueTeam.totalGold)
    const formattedRedTeamGold = formatTeamGoldInK(lastWindowFrame.redTeam.totalGold)
    const formattedGoldLead = formatGoldInK(Math.abs(goldLead))
    const blueBaronPowerPlayClassName = getBaronPowerPlayClassName(`blue`)
    const redBaronPowerPlayClassName = getBaronPowerPlayClassName(`red`)
    const displayBlueBaronPowerPlay = FORCE_BARON_UI_PREVIEW ? 1500 : baronPowerPlayByTeam.blue
    const displayRedBaronPowerPlay = FORCE_BARON_UI_PREVIEW ? 900 : baronPowerPlayByTeam.red
    const displayBlueBaronPowerPlayRemainingSeconds = FORCE_BARON_UI_PREVIEW ? 128 : baronPowerPlayRemainingSecondsByTeam.blue
    const displayRedBaronPowerPlayRemainingSeconds = FORCE_BARON_UI_PREVIEW ? 79 : baronPowerPlayRemainingSecondsByTeam.red
    const displayBlueElderBuffRemainingSeconds = FORCE_BARON_UI_PREVIEW ? 95 : elderBuffRemainingSecondsByTeam.blue
    const displayRedElderBuffRemainingSeconds = FORCE_BARON_UI_PREVIEW ? 47 : elderBuffRemainingSecondsByTeam.red
    const formattedBlueBaronPowerPlay = formatBaronPowerPlayValue(displayBlueBaronPowerPlay)
    const formattedRedBaronPowerPlay = formatBaronPowerPlayValue(displayRedBaronPowerPlay)
    const formattedBlueBaronPowerPlayRemaining = formatBaronPowerPlayRemainingTime(displayBlueBaronPowerPlayRemainingSeconds)
    const formattedRedBaronPowerPlayRemaining = formatBaronPowerPlayRemainingTime(displayRedBaronPowerPlayRemainingSeconds)
    const formattedBlueElderBuffRemaining = formatBaronPowerPlayRemainingTime(displayBlueElderBuffRemainingSeconds)
    const formattedRedElderBuffRemaining = formatBaronPowerPlayRemainingTime(displayRedElderBuffRemainingSeconds)
    const goldLeadSymbolAlignmentClass = goldLead > 0 ? `gold-lead-symbol-left` : goldLead < 0 ? `gold-lead-symbol-right` : ``
    const goldLeadColorClass = goldLead > 0 ? `gold-advantage-blue` : goldLead < 0 ? `gold-advantage-red` : `gold-advantage-neutral`
    const backfillStatusClassName = backfillStatus === `running` ? `running` : backfillStatus === `completed` ? `completed` : `idle`
    const backfillStatusLabel = backfillStatus === `running`
        ? `Backfill in progress: syncing historical items...`
        : backfillStatus === `completed`
            ? `Backfill completed: historical items synced.`
            : `Backfill pending: waiting for timeline sync trigger.`
    const parsedCurrentFrameTimestampMs = Date.parse(lastWindowFrame.rfc460Timestamp)
    const localElapsedSinceLastWindowMs = lastWindowFrame.gameState === `in_game`
        ? Math.max(0, objectiveTimerTickMs - lastWindowFrameSyncedAtMsRef.current)
        : 0
    const currentFrameTimestampMs = Number.isFinite(parsedCurrentFrameTimestampMs)
        ? parsedCurrentFrameTimestampMs + localElapsedSinceLastWindowMs
        : parsedCurrentFrameTimestampMs
    const currentFrameTimestamp = Number.isFinite(currentFrameTimestampMs)
        ? new Date(currentFrameTimestampMs).toISOString()
        : lastWindowFrame.rfc460Timestamp
    const elapsedGameTimeSeconds = getElapsedGameTimeSeconds(firstWindowFrame.rfc460Timestamp, currentFrameTimestamp)
    const baronObjectiveStatusLabel = getBaronObjectiveStatusLabel(
        elapsedGameTimeSeconds,
        currentFrameTimestampMs,
        lastBaronKillTimestampMsRef.current,
    )
    const heraldKillCount = Number(inferredHeraldKillCounts.blue || 0) + Number(inferredHeraldKillCounts.red || 0)
    const hasHeraldBeenKilled = heraldKillCount > 0
    const shouldShowHeraldInBaronSlot = elapsedGameTimeSeconds < BARON_FIRST_SPAWN_SECONDS && !hasHeraldBeenKilled
    const heraldObjectiveStatusLabel = getHeraldObjectiveStatusLabel(elapsedGameTimeSeconds, hasHeraldBeenKilled)
    const baronPreSpawnStatusLabel = getBaronPreSpawnStatusLabel(elapsedGameTimeSeconds)
    const blueElementalDragonKillCount = getTeamElementalDragonKillCount(lastWindowFrame.blueTeam.dragons)
    const redElementalDragonKillCount = getTeamElementalDragonKillCount(lastWindowFrame.redTeam.dragons)
    const shouldUseElderDragonObjectiveIcon = FORCE_BARON_UI_PREVIEW || blueElementalDragonKillCount >= 4 || redElementalDragonKillCount >= 4
    const DragonObjectiveStatusIcon = shouldUseElderDragonObjectiveIcon ? ElderDragonSVG : DragonObjectiveSVG
    const BaronOrHeraldObjectiveIcon = shouldShowHeraldInBaronSlot ? `herald` : `baron`
    const dragonObjectiveStatusLabel = getDragonObjectiveStatusLabel(
        elapsedGameTimeSeconds,
        currentFrameTimestampMs,
        lastDragonKillTimestampMsRef.current,
        shouldUseElderDragonObjectiveIcon,
    )
    const computedBaronOrHeraldStatusLabel = shouldShowHeraldInBaronSlot
        ? heraldObjectiveStatusLabel
        : elapsedGameTimeSeconds < BARON_FIRST_SPAWN_SECONDS
            ? baronPreSpawnStatusLabel
            : baronObjectiveStatusLabel
    const displayBaronObjectiveStatusLabel = FORCE_BARON_UI_PREVIEW ? `-1:45` : computedBaronOrHeraldStatusLabel
    const displayDragonObjectiveStatusLabel = FORCE_BARON_UI_PREVIEW ? `-4:12` : dragonObjectiveStatusLabel
    let inGameTime = getInGameTime(firstWindowFrame.rfc460Timestamp, currentFrameTimestamp)
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

    function toggleMirrorParticipantStats(leftParticipantId: number, rightParticipantId: number) {
        setMirrorExpandedParticipantIds((previousState) => {
            const isRowExpanded = previousState.includes(leftParticipantId) || previousState.includes(rightParticipantId)
            if (isRowExpanded) {
                return previousState.filter((id) => id !== leftParticipantId && id !== rightParticipantId)
            }

            const nextState = previousState.filter((id) => id !== leftParticipantId && id !== rightParticipantId)
            nextState.push(leftParticipantId, rightParticipantId)
            return nextState
        })
    }

    function isMirrorParticipantStatsExpanded(participantId: number) {
        return mirrorExpandedParticipantIds.includes(participantId)
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
        let vods = eventDetails.match.games[gameIndex - 1].vods

        if (vods.length) {
            streamsOrVods = vods
        } else {
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
        }

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

    const blueRows = lastWindowFrame.blueTeam.participants.map((player: WindowParticipant, index) => {
        const championDetails = lastDetailsFrame.participants[index]
        const metadata = gameMetadata.blueTeamMetadata.participantMetadata[player.participantId - 1]
        const deathTimerSeconds = deathTimerSecondsByParticipantId[player.participantId]
        const hasDeathTimer = Number.isFinite(deathTimerSeconds) && Number(deathTimerSeconds) > 0
        return {
            side: `blue` as const,
            player,
            championDetails,
            metadata,
            hasDeathTimer,
            deathTimerSeconds,
            killFlashClassName: kdaFlashByCell[`k_${player.participantId}`] ? `player-stats-kda-flash-kill` : ``,
            deathFlashClassName: kdaFlashByCell[`d_${player.participantId}`] ? `player-stats-kda-flash-death` : ``,
            assistFlashClassName: kdaFlashByCell[`a_${player.participantId}`] ? `player-stats-kda-flash-assist` : ``,
        }
    })

    const redRows = lastWindowFrame.redTeam.participants.map((player: WindowParticipant, index) => {
        const championDetails = lastDetailsFrame.participants[index + 5]
        const metadata = gameMetadata.redTeamMetadata.participantMetadata[player.participantId - 6]
        const deathTimerSeconds = deathTimerSecondsByParticipantId[player.participantId]
        const hasDeathTimer = Number.isFinite(deathTimerSeconds) && Number(deathTimerSeconds) > 0
        return {
            side: `red` as const,
            player,
            championDetails,
            metadata,
            hasDeathTimer,
            deathTimerSeconds,
            killFlashClassName: kdaFlashByCell[`k_${player.participantId}`] ? `player-stats-kda-flash-kill` : ``,
            deathFlashClassName: kdaFlashByCell[`d_${player.participantId}`] ? `player-stats-kda-flash-death` : ``,
            assistFlashClassName: kdaFlashByCell[`a_${player.participantId}`] ? `player-stats-kda-flash-assist` : ``,
        }
    })

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
                                {outcome ? (<p className={outcome[0].outcome}>
                                    {outcome[0].outcome}
                                </p>) : null}
                            </span>
                        </div>
                        <h1>
                            <div className={`gamestate-bg-${gameState.split(` `).join(`-`)}`}>{getLiveGameStateLabel(gameState)}</div>
                            <div>{inGameTime}</div>
                            <div className="live-game-kill-score">
                                <span className="blue-team-kills">{lastWindowFrame.blueTeam.totalKills}</span>
                                <KillSVG className="live-game-kill-score-icon" />
                                <span className="red-team-kills">{lastWindowFrame.redTeam.totalKills}</span>
                            </div>
                            {displayBaronObjectiveStatusLabel || displayDragonObjectiveStatusLabel ? (
                                <div className="live-game-objective-statuses">
                                    {displayDragonObjectiveStatusLabel ? (
                                        <div className="live-game-objective-status">
                                            <DragonObjectiveStatusIcon className="live-game-objective-status-icon" />
                                            <span className={`live-game-objective-status-label ${displayDragonObjectiveStatusLabel === `LIVE` ? `live` : ``}`}>
                                                {displayDragonObjectiveStatusLabel}
                                            </span>
                                        </div>
                                    ) : null}
                                    {displayBaronObjectiveStatusLabel ? (
                                        <div className="live-game-objective-status">
                                            {BaronOrHeraldObjectiveIcon === `herald` ? (
                                                <img src={HeraldIcon} className="live-game-objective-status-icon-image" alt="" />
                                            ) : (
                                                <BaronSVG className="live-game-objective-status-icon" />
                                            )}
                                            <span className={`live-game-objective-status-label ${displayBaronObjectiveStatusLabel === `LIVE` ? `live` : ``}`}>
                                                {displayBaronObjectiveStatusLabel}
                                            </span>
                                        </div>
                                    ) : null}
                                </div>
                            ) : null}
                        </h1>
                        <div className="live-game-card-team">
                            {redTeam.code === "TBD" ? (<TeamTBDSVG className="live-game-card-team-image" />) : (<img className="live-game-card-team-image" src={redTeam.image} alt={redTeam.name} />)}
                            <span>
                                <h4>
                                    {redTeam.name}
                                </h4>
                            </span>
                            <span className='outcome'>
                                {outcome ? (<p className={outcome[1].outcome}>
                                    {outcome[1].outcome}
                                </p>) : null}
                            </span>
                        </div>
                    </div>
                    <div className="live-game-stats-header-status">
                        {HeaderStats(lastWindowFrame.blueTeam, 'blue-team', inferredHeraldKillCounts.blue)}
                        {HeaderStats(lastWindowFrame.redTeam, 'red-team', inferredHeraldKillCounts.red)}
                    </div>
                    <div className="live-game-stats-header-gold">
                        <div className="live-game-stats-header-gold-values">
                            <span className="team-gold-side-group team-gold-side-group-blue">
                                {displayBlueElderBuffRemainingSeconds !== null ? (
                                    <span className="team-gold-elder-buff team-gold-elder-buff-blue">
                                        <ElderDragonSVG className="team-gold-elder-buff-icon" />
                                        <span className="team-gold-elder-buff-remaining">{formattedBlueElderBuffRemaining}</span>
                                    </span>
                                ) : null}
                                {displayBlueBaronPowerPlay !== null ? (
                                    <span className={`team-gold-power-play-block team-gold-power-play-block-near-blue ${blueBaronPowerPlayClassName}`}>
                                        <span className="team-gold-power-play-remaining">{formattedBlueBaronPowerPlayRemaining}</span>
                                        <span className={`team-gold-power-play ${blueBaronPowerPlayClassName}`}>
                                            <BaronSVG className="team-gold-power-play-icon" />
                                            <span className="team-gold-power-play-value">{formattedBlueBaronPowerPlay}</span>
                                        </span>
                                    </span>
                                ) : null}
                                <span className={`team-gold-value team-gold-value-blue ${goldLead > 0 ? `gold-advantage-blue` : ``}`}>{formattedBlueTeamGold}</span>
                            </span>
                            <span className={`gold-lead-indicator ${goldLeadColorClass}`}>
                                {goldLeadSymbol ? (
                                    <span className={`gold-lead-symbol ${goldLeadSymbolAlignmentClass} ${goldLeadColorClass}`}>{goldLeadSymbol}</span>
                                ) : null}
                                <span className={`gold-lead-value ${goldLeadColorClass}`}>{formattedGoldLead}</span>
                            </span>
                            <span className="team-gold-side-group team-gold-side-group-red">
                                <span className={`team-gold-value team-gold-value-red ${goldLead < 0 ? `gold-advantage-red` : ``}`}>{formattedRedTeamGold}</span>
                                {displayRedBaronPowerPlay !== null ? (
                                    <span className={`team-gold-power-play-block team-gold-power-play-block-near-red ${redBaronPowerPlayClassName}`}>
                                        <span className="team-gold-power-play-remaining">{formattedRedBaronPowerPlayRemaining}</span>
                                        <span className={`team-gold-power-play ${redBaronPowerPlayClassName}`}>
                                            <BaronSVG className="team-gold-power-play-icon" />
                                            <span className="team-gold-power-play-value">{formattedRedBaronPowerPlay}</span>
                                        </span>
                                    </span>
                                ) : null}
                                {displayRedElderBuffRemainingSeconds !== null ? (
                                    <span className="team-gold-elder-buff team-gold-elder-buff-red">
                                        <ElderDragonSVG className="team-gold-elder-buff-icon" />
                                        <span className="team-gold-elder-buff-remaining">{formattedRedElderBuffRemaining}</span>
                                    </span>
                                ) : null}
                            </span>
                        </div>
                        <div className="live-game-stats-header-gold-bar">
                            <div className="blue-team" style={{ flex: goldPercentage.goldBluePercentage }} />
                            <div className="red-team" style={{ flex: goldPercentage.goldRedPercentage }} />
                        </div>
                    </div>
                    <div className="live-game-stats-header-dragons">
                        <div className="blue-team">
                            {lastWindowFrame.blueTeam.dragons.map((dragon, i) => (
                                getDragonSVG(dragon, 'blue', i)
                            ))}
                        </div>
                        <div className="red-team">

                            {lastWindowFrame.redTeam.dragons.slice().reverse().map((dragon, i) => (
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
                            {lastWindowFrame.blueTeam.participants.map((player: WindowParticipant, index) => {
                                let goldDifference = getGoldDifference(player, lastWindowFrame);
                                let championDetails = lastDetailsFrame.participants[index]
                                const killFlashClassName = kdaFlashByCell[`k_${player.participantId}`] ? `player-stats-kda-flash-kill` : ``
                                const deathFlashClassName = kdaFlashByCell[`d_${player.participantId}`] ? `player-stats-kda-flash-death` : ``
                                const assistFlashClassName = kdaFlashByCell[`a_${player.participantId}`] ? `player-stats-kda-flash-assist` : ``
                                const deathTimerSeconds = deathTimerSecondsByParticipantId[player.participantId]
                                const hasDeathTimer = Number.isFinite(deathTimerSeconds) && Number(deathTimerSeconds) > 0
                                return [(
                                    <tr className="player-stats-row" key={`${gameIndex}_${championsUrlWithPatchVersion}${gameMetadata.blueTeamMetadata.participantMetadata[player.participantId - 1].championId}`}>
                                        <th>
                                            <div className={`player-champion-info ${hasDeathTimer ? `player-champion-info-dead` : ``}`}>
                                                {getParticipantRuneTypes(championDetails, runes)}
                                                <div className={`player-champion-wrapper ${hasDeathTimer ? `dead` : ``}`}>
                                                    {hasDeathTimer ? <span className="player-death-timer">{deathTimerSeconds}</span> : null}
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
                                            <ItemsDisplay
                                                participantId={player.participantId - 1}
                                                lastFrame={lastDetailsFrame}
                                                items={items}
                                                patchVersion={formattedPatchVersion}
                                                role={gameMetadata.blueTeamMetadata.participantMetadata[player.participantId - 1].role}
                                            />
                                        </td>
                                        <td>
                                            <div className=" player-stats">{player.creepScore}</div>
                                        </td>
                                        <td>
                                            <div className={` player-stats player-stats-kda ${killFlashClassName}`}>{player.kills}</div>
                                        </td>
                                        <td>
                                            <div className={` player-stats player-stats-kda ${deathFlashClassName}`}>{player.deaths}</div>
                                        </td>
                                        <td>
                                            <div className={` player-stats player-stats-kda ${assistFlashClassName}`}>{player.assists}</div>
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
                                                {getFormattedChampionStats(
                                                    championDetails,
                                                    runes,
                                                    selectedRuneKeyByParticipantId[championDetails.participantId],
                                                    (runeKey) => setSelectedRuneKeyByParticipantId((previousState) => ({
                                                        ...previousState,
                                                        [championDetails.participantId]: runeKey,
                                                    })),
                                                )}
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
                            {lastWindowFrame.redTeam.participants.map((player: WindowParticipant, index) => {
                                let goldDifference = getGoldDifference(player, lastWindowFrame);
                                let championDetails = lastDetailsFrame.participants[index + 5]
                                const killFlashClassName = kdaFlashByCell[`k_${player.participantId}`] ? `player-stats-kda-flash-kill` : ``
                                const deathFlashClassName = kdaFlashByCell[`d_${player.participantId}`] ? `player-stats-kda-flash-death` : ``
                                const assistFlashClassName = kdaFlashByCell[`a_${player.participantId}`] ? `player-stats-kda-flash-assist` : ``
                                const deathTimerSeconds = deathTimerSecondsByParticipantId[player.participantId]
                                const hasDeathTimer = Number.isFinite(deathTimerSeconds) && Number(deathTimerSeconds) > 0

                                return [(
                                    <tr className="player-stats-row" key={`${gameIndex}_${championsUrlWithPatchVersion}${gameMetadata.redTeamMetadata.participantMetadata[player.participantId - 6].championId}`}>
                                        <th>
                                            <div className={`player-champion-info ${hasDeathTimer ? `player-champion-info-dead` : ``}`}>
                                                {getParticipantRuneTypes(championDetails, runes)}
                                                <div className={`player-champion-wrapper ${hasDeathTimer ? `dead` : ``}`}>
                                                    {hasDeathTimer ? <span className="player-death-timer">{deathTimerSeconds}</span> : null}
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
                                            <ItemsDisplay
                                                participantId={player.participantId - 1}
                                                lastFrame={lastDetailsFrame}
                                                items={items}
                                                patchVersion={formattedPatchVersion}
                                                role={gameMetadata.redTeamMetadata.participantMetadata[player.participantId - 6].role}
                                            />
                                        </td>
                                        <td>
                                            <div className=" player-stats">{player.creepScore}</div>
                                        </td>
                                        <td>
                                            <div className={` player-stats player-stats-kda ${killFlashClassName}`}>{player.kills}</div>
                                        </td>
                                        <td>
                                            <div className={` player-stats player-stats-kda ${deathFlashClassName}`}>{player.deaths}</div>
                                        </td>
                                        <td>
                                            <div className={` player-stats player-stats-kda ${assistFlashClassName}`}>{player.assists}</div>
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
                                                {getFormattedChampionStats(
                                                    championDetails,
                                                    runes,
                                                    selectedRuneKeyByParticipantId[championDetails.participantId],
                                                    (runeKey) => setSelectedRuneKeyByParticipantId((previousState) => ({
                                                        ...previousState,
                                                        [championDetails.participantId]: runeKey,
                                                    })),
                                                )}
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
                            {blueRows.map((blueRow, rowIndex) => {
                                const redRow = redRows[rowIndex]
                                if (!redRow) return null

                                const isBlueExpanded = isMirrorParticipantStatsExpanded(blueRow.player.participantId)
                                const isRedExpanded = isMirrorParticipantStatsExpanded(redRow.player.participantId)
                                const shouldRenderExpandedRow = isBlueExpanded || isRedExpanded
                                const rowGoldLead = blueRow.player.totalGold - redRow.player.totalGold
                                const rowGoldLeadColorClass = rowGoldLead > 0 ? `gold-advantage-blue` : rowGoldLead < 0 ? `gold-advantage-red` : `gold-advantage-neutral`
                                const rowGoldLeadMarker = getGoldLeadSymbol(rowGoldLead)
                                const rowGoldLeadSymbolAlignmentClass = rowGoldLead > 0 ? `mirror-row-gold-symbol-left` : rowGoldLead < 0 ? `mirror-row-gold-symbol-right` : ``
                                const rowGoldLeadValue = Number(Math.abs(rowGoldLead)).toLocaleString(`en-us`)

                                return [
                                    (
                                        <tr className="mirror-player-row" key={`mirror_${gameIndex}_${blueRow.player.participantId}_${redRow.player.participantId}`}>
                                            <td>
                                                <ItemsDisplay
                                                    participantId={blueRow.player.participantId - 1}
                                                    lastFrame={lastDetailsFrame}
                                                    items={items}
                                                    patchVersion={formattedPatchVersion}
                                                    role={blueRow.metadata.role}
                                                    reverseWithTrinketFirst={true}
                                                />
                                            </td>
                                            <td>
                                                <MiniHealthBar currentHealth={blueRow.player.currentHealth} maxHealth={blueRow.player.maxHealth} />
                                            </td>
                                            <th className="mirror-player-cell mirror-player-cell-left">
                                                <button type="button" className="mirror-player-toggle" onClick={() => toggleMirrorParticipantStats(blueRow.player.participantId, redRow.player.participantId)}>
                                                    <div className={`player-champion-info mirror-player-champion-info-left ${blueRow.hasDeathTimer ? `player-champion-info-dead` : ``}`}>
                                                        <div className=" player-champion-info-name mirror-player-name-left">
                                                            <span>{blueRow.metadata.summonerName}</span>
                                                            <span className=" player-card-player-name">{getChampionDisplayName(blueRow.metadata.championId)}</span>
                                                        </div>
                                                        <div className={`player-champion-wrapper ${blueRow.hasDeathTimer ? `dead` : ``}`}>
                                                            {blueRow.hasDeathTimer ? <span className="player-death-timer">{blueRow.deathTimerSeconds}</span> : null}
                                                            <img src={`${championsUrlWithPatchVersion}${blueRow.metadata.championId}.png`} alt="" className='player-champion' onError={({ currentTarget }) => { currentTarget.style.display = `none` }} />
                                                            <TeamTBDSVG className='player-champion' />
                                                            <span className=" player-champion-info-level">{blueRow.player.level}</span>
                                                        </div>
                                                        {getParticipantRuneTypes(blueRow.championDetails, runes)}
                                                    </div>
                                                </button>
                                            </th>
                                            <td><div className={` player-stats player-stats-kda ${blueRow.killFlashClassName}`}>{blueRow.player.kills}</div></td>
                                            <td><div className={` player-stats player-stats-kda ${blueRow.deathFlashClassName}`}>{blueRow.player.deaths}</div></td>
                                            <td><div className={` player-stats player-stats-kda ${blueRow.assistFlashClassName}`}>{blueRow.player.assists}</div></td>
                                            <td><div className=" player-stats">{blueRow.player.creepScore}</div></td>
                                            <td className="mirror-row-gold-cell">
                                                <div className={`mirror-row-gold-diff ${rowGoldLeadColorClass}`}>
                                                    {rowGoldLeadMarker ? <span className={`mirror-row-gold-symbol ${rowGoldLeadSymbolAlignmentClass}`}>{rowGoldLeadMarker}</span> : null}
                                                    <span className="mirror-row-gold-value">{rowGoldLeadValue}</span>
                                                </div>
                                            </td>
                                            <td><div className=" player-stats">{redRow.player.creepScore}</div></td>
                                            <td><div className={` player-stats player-stats-kda ${redRow.killFlashClassName}`}>{redRow.player.kills}</div></td>
                                            <td><div className={` player-stats player-stats-kda ${redRow.deathFlashClassName}`}>{redRow.player.deaths}</div></td>
                                            <td><div className={` player-stats player-stats-kda ${redRow.assistFlashClassName}`}>{redRow.player.assists}</div></td>
                                            <th className="mirror-player-cell mirror-player-cell-right">
                                                <button type="button" className="mirror-player-toggle" onClick={() => toggleMirrorParticipantStats(blueRow.player.participantId, redRow.player.participantId)}>
                                                    <div className={`player-champion-info mirror-player-champion-info-right ${redRow.hasDeathTimer ? `player-champion-info-dead` : ``}`}>
                                                        {getParticipantRuneTypes(redRow.championDetails, runes)}
                                                        <div className={`player-champion-wrapper ${redRow.hasDeathTimer ? `dead` : ``}`}>
                                                            {redRow.hasDeathTimer ? <span className="player-death-timer">{redRow.deathTimerSeconds}</span> : null}
                                                            <img src={`${championsUrlWithPatchVersion}${redRow.metadata.championId}.png`} alt="" className='player-champion' onError={({ currentTarget }) => { currentTarget.style.display = `none` }} />
                                                            <TeamTBDSVG className='player-champion' />
                                                            <span className=" player-champion-info-level">{redRow.player.level}</span>
                                                        </div>
                                                        <div className=" player-champion-info-name mirror-player-name-right">
                                                            <span>{redRow.metadata.summonerName}</span>
                                                            <span className=" player-card-player-name">{getChampionDisplayName(redRow.metadata.championId)}</span>
                                                        </div>
                                                    </div>
                                                </button>
                                            </th>
                                            <td>
                                                <MiniHealthBar currentHealth={redRow.player.currentHealth} maxHealth={redRow.player.maxHealth} />
                                            </td>
                                            <td>
                                                <ItemsDisplay
                                                    participantId={redRow.player.participantId - 1}
                                                    lastFrame={lastDetailsFrame}
                                                    items={items}
                                                    patchVersion={formattedPatchVersion}
                                                    role={redRow.metadata.role}
                                                />
                                            </td>
                                        </tr>
                                    ),
                                    shouldRenderExpandedRow ? (
                                        <tr className="mirror-champion-stats-row" key={`mirror_stats_${gameIndex}_${blueRow.player.participantId}_${redRow.player.participantId}`}>
                                            <td colSpan={15}>
                                                <div className="mirror-stats-panels">
                                                    <div className="mirror-stats-panel">
                                                        {isBlueExpanded ? getFormattedChampionStats(
                                                            blueRow.championDetails,
                                                            runes,
                                                            selectedRuneKeyByParticipantId[blueRow.championDetails.participantId],
                                                            (runeKey) => setSelectedRuneKeyByParticipantId((previousState) => ({
                                                                ...previousState,
                                                                [blueRow.championDetails.participantId]: runeKey,
                                                            })),
                                                        ) : null}
                                                    </div>
                                                    <div className="mirror-stats-panel">
                                                        {isRedExpanded ? getFormattedChampionStats(
                                                            redRow.championDetails,
                                                            runes,
                                                            selectedRuneKeyByParticipantId[redRow.championDetails.participantId],
                                                            (runeKey) => setSelectedRuneKeyByParticipantId((previousState) => ({
                                                                ...previousState,
                                                                [redRow.championDetails.participantId]: runeKey,
                                                            })),
                                                        ) : null}
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    ) : null
                                ]
                            })}
                        </tbody>
                    </table>
                </div>
                )}
                <span className="footer-notes">
                    <a target="_blank" rel="noreferrer" href={`https://www.leagueoflegends.com/en-us/news/game-updates/patch-26-${gameMetadata.patchVersion.split(`.`)[1].length > 1 ? gameMetadata.patchVersion.split(`.`)[1] : "" + gameMetadata.patchVersion.split(`.`)[1]}-notes/`}>Patch Version: {gameMetadata.patchVersion}</a>
                </span>
                <span className="footer-notes">
                    <button type="button" className="copy-champion-names" onClick={copyChampionNames}>
                        Copy Champion Names
                    </button>
                </span>
                <span className={`footer-notes backfill-status ${backfillStatusClassName}`}>{backfillStatusLabel}</span>
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
            <LiveAPIWatcher gameIndex={gameIndex} gameMetadata={gameMetadata} lastWindowFrame={lastWindowFrame} championsUrlWithPatchVersion={championsUrlWithPatchVersion} blueTeam={eventDetails.match.teams[0]} redTeam={eventDetails.match.teams[1]} />
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

function getFormattedChampionStats(
    championDetails: Participant,
    runes: Rune[],
    selectedRuneKey: string | undefined,
    onSelectRuneKey: (runeKey: string) => void,
) {
    return (
        <div className="champion-stats-content">
            <div className='footer-notes'>공격력: {championDetails.attackDamage}</div>
            <div className='footer-notes'>주문력: {championDetails.abilityPower}</div>
            <div className='footer-notes'>공격 속도: {championDetails.attackSpeed}</div>
            <div className='footer-notes'>생명력 흡수: {championDetails.lifeSteal}%</div>
            <div className='footer-notes'>방어력: {championDetails.armor}</div>
            <div className='footer-notes'>마법 저항력: {championDetails.magicResistance}</div>
            <div className='footer-notes'>와드 파괴: {championDetails.wardsDestroyed}</div>
            <div className='footer-notes'>와드 설치: {championDetails.wardsPlaced}</div>
            <div className='footer-notes'>딜량 기여도: {Math.round(championDetails.championDamageShare * 10000) / 100}%</div>
            <div className='footer-notes'>킬 관여도: {Math.round(championDetails.killParticipation * 10000) / 100}%</div>
            <div className='footer-notes'>스킬 순서: {championDetails.abilities.join('->')}</div>
            {getFormattedRunes(championDetails, runes, selectedRuneKey, onSelectRuneKey)}
        </div>
    )
}

function getParticipantRuneTypes(championDetails: Participant | undefined, runes: Rune[]) {
    const slottedRunes = getSlottedRunes(runes)
    const primaryPerk = championDetails ? slottedRunes.find((slottedRune) => slottedRune.id === championDetails.perkMetadata.perks[0]) : undefined
    const primaryStyle = championDetails ? runes.find((rune) => rune.id === championDetails.perkMetadata.styleId) : undefined
    const subStyle = championDetails ? runes.find((rune) => rune.id === championDetails.perkMetadata.subStyleId) : undefined

    return (
        <div className="player-rune-types">
            {primaryPerk ? (
                <img className="player-rune-type-icon" src={getRuneUrlFromIcon(runes, primaryPerk.icon)} alt={primaryPerk.name} />
            ) : primaryStyle ? (
                <img className="player-rune-type-icon" src={getRuneUrlFromIcon(runes, primaryStyle.icon)} alt={primaryStyle.name} />
            ) : (
                <div className="player-rune-type-empty" />
            )}
            {subStyle ? (
                <img className="player-rune-type-icon" src={getRuneUrlFromIcon(runes, subStyle.icon)} alt={subStyle.name} />
            ) : (
                <div className="player-rune-type-empty" />
            )}
        </div>
    )
}

function getRuneUrlFromIcon(runes: Rune[], icon: string) {
    const perkImageUrl = `https://ddragon.leagueoflegends.com/cdn/img/PERK_ICON`
    return perkImageUrl.replace(`PERK_ICON`, icon)
}

function getSlottedRunes(runes: Rune[]): Array<SlottedRune> {
    const slottedRunes: Array<SlottedRune> = []
    runes.forEach(rune => {
        rune.slots.forEach(slot => {
            slot.runes.forEach(slottedRune => {
                slottedRunes.push(slottedRune)
            })
        })
    })
    return slottedRunes
}

type RuneDetailPanelData = {
    key: string
    name: string
    iconUrl?: string
    descriptionHtml?: string
    descriptionText?: string
    glyph?: string
    tone?: `offense` | `utility` | `defense`
}

function getFormattedRunes(
    championDetails: Participant,
    runes: Rune[],
    selectedRuneKey: string | undefined,
    onSelectRuneKey: (runeKey: string) => void,
) {
    const selectedPerkIds = new Set<number>(championDetails.perkMetadata.perks)
    const primaryKeystonePerkId = championDetails.perkMetadata.perks[0]
    const primaryStyle = runes.find((rune) => rune.id === championDetails.perkMetadata.styleId)
    const subStyle = runes.find((rune) => rune.id === championDetails.perkMetadata.subStyleId)
    const statShardPerkIds = championDetails.perkMetadata.perks.filter((perkId) => STAT_SHARD_FALLBACK_BY_PERK_ID[perkId]).slice(0, 3)
    const runeDetailsByKey: { [runeKey: string]: RuneDetailPanelData } = {}
    let fallbackSelectedRuneKey = ``

    const registerRuneDetail = (detail: RuneDetailPanelData) => {
        runeDetailsByKey[detail.key] = detail
    }

    return (
        <div className="rune-list rune-style-layout">
            <div className="rune-style-board">
                <section className="rune-style-column">
                    <div className="rune-style-title">메인 룬</div>
                    <div className="rune-style-grid">
                        {primaryStyle ? (
                            primaryStyle.slots.map((slot, slotIndex) => (
                                <div className="rune-style-row" key={`primary_slot_${slotIndex}`}>
                                    {slot.runes.map((slottedRune) => {
                                        const isSelected = selectedPerkIds.has(slottedRune.id)
                                        const runeKey = `rune_${slottedRune.id}`
                                        const isKeystone = slotIndex === 0
                                        const isActive = (selectedRuneKey ?? `rune_${primaryKeystonePerkId}`) === runeKey
                                        registerRuneDetail({
                                            key: runeKey,
                                            name: slottedRune.name,
                                            iconUrl: getRuneUrlFromIcon(runes, slottedRune.icon),
                                            descriptionHtml: slottedRune.longDesc,
                                        })
                                        if (!fallbackSelectedRuneKey && slottedRune.id === primaryKeystonePerkId) {
                                            fallbackSelectedRuneKey = runeKey
                                        }
                                        return (
                                            <button
                                                type="button"
                                                key={`primary_rune_${slottedRune.id}`}
                                                className={`rune-style-item-button ${isActive ? `active` : ``}`}
                                                onClick={() => onSelectRuneKey(runeKey)}
                                                title={slottedRune.name}
                                            >
                                                <img
                                                    className={`rune-style-icon ${isSelected ? `selected` : `muted`} ${isKeystone ? `keystone` : ``}`}
                                                    src={getRuneUrlFromIcon(runes, slottedRune.icon)}
                                                    alt={slottedRune.name}
                                                />
                                            </button>
                                        )
                                    })}
                                </div>
                            ))
                        ) : (
                            <div className="rune-style-empty">메인 룬 정보가 없습니다.</div>
                        )}
                    </div>
                </section>

                <section className="rune-style-column">
                    <div className="rune-style-title">보조 룬</div>
                    <div className="rune-style-grid">
                        {subStyle ? (
                            subStyle.slots
                                .filter((_, slotIndex) => slotIndex > 0)
                                .map((slot, slotIndex) => (
                                    <div className="rune-style-row" key={`sub_slot_${slotIndex}`}>
                                        {slot.runes.map((slottedRune) => {
                                            const isSelected = selectedPerkIds.has(slottedRune.id)
                                            const runeKey = `rune_${slottedRune.id}`
                                            const isActive = (selectedRuneKey ?? `rune_${primaryKeystonePerkId}`) === runeKey
                                            registerRuneDetail({
                                                key: runeKey,
                                                name: slottedRune.name,
                                                iconUrl: getRuneUrlFromIcon(runes, slottedRune.icon),
                                                descriptionHtml: slottedRune.longDesc,
                                            })
                                            return (
                                                <button
                                                    type="button"
                                                    key={`sub_rune_${slottedRune.id}`}
                                                    className={`rune-style-item-button ${isActive ? `active` : ``}`}
                                                    onClick={() => onSelectRuneKey(runeKey)}
                                                    title={slottedRune.name}
                                                >
                                                    <img
                                                        className={`rune-style-icon ${isSelected ? `selected` : `muted`}`}
                                                        src={getRuneUrlFromIcon(runes, slottedRune.icon)}
                                                        alt={slottedRune.name}
                                                    />
                                                </button>
                                            )
                                        })}
                                    </div>
                                ))
                        ) : (
                            <div className="rune-style-empty">보조 룬 정보가 없습니다.</div>
                        )}
                    </div>
                </section>

                <div className="rune-shard-row">
                    {statShardPerkIds.map((perkId) => {
                        const shard = STAT_SHARD_FALLBACK_BY_PERK_ID[perkId]
                        if (!shard) return null
                        const shardPresentation = STAT_SHARD_PRESENTATION_BY_PERK_ID[perkId]
                        const runeKey = `shard_${perkId}`
                        const isActive = selectedRuneKey === runeKey
                        registerRuneDetail({
                            key: runeKey,
                            name: shard.name,
                            descriptionText: shard.description,
                            glyph: shardPresentation?.glyph ?? `S`,
                            tone: shardPresentation?.tone,
                        })
                        return (
                            <button
                                type="button"
                                className={`rune-style-item-button rune-shard-button ${isActive ? `active` : ``}`}
                                key={`stat_shard_${perkId}`}
                                title={`${shard.name}: ${shard.description}`}
                                onClick={() => onSelectRuneKey(runeKey)}
                            >
                                <div className={`rune-shard-badge ${shardPresentation ? `rune-shard-${shardPresentation.tone}` : ``}`}>
                                    <span className="rune-shard-glyph">{shardPresentation ? shardPresentation.glyph : `S`}</span>
                                </div>
                            </button>
                        )
                    })}
                </div>
            </div>

            {(() => {
                const defaultRuneKey = selectedRuneKey && runeDetailsByKey[selectedRuneKey]
                    ? selectedRuneKey
                    : fallbackSelectedRuneKey
                const selectedRuneDetail = defaultRuneKey ? runeDetailsByKey[defaultRuneKey] : undefined
                if (!selectedRuneDetail) return <aside className="rune-detail-panel">No rune description</aside>
                return (
                    <aside className="rune-detail-panel">
                        <div className="rune-detail-header">
                            {selectedRuneDetail.iconUrl ? (
                                <img className="rune-detail-icon" src={selectedRuneDetail.iconUrl} alt={selectedRuneDetail.name} />
                            ) : (
                                <div className={`rune-shard-badge rune-detail-shard ${selectedRuneDetail.tone ? `rune-shard-${selectedRuneDetail.tone}` : ``}`}>
                                    <span className="rune-shard-glyph">{selectedRuneDetail.glyph ?? `S`}</span>
                                </div>
                            )}
                            <div className="rune-detail-title">{selectedRuneDetail.name}</div>
                        </div>
                        {selectedRuneDetail.descriptionHtml ? (
                            <div className="rune-detail-body rune-detail-rich-text" dangerouslySetInnerHTML={{ __html: selectedRuneDetail.descriptionHtml }} />
                        ) : (
                            <div className="rune-detail-body">{selectedRuneDetail.descriptionText ?? ``}</div>
                        )}
                    </aside>
                )
            })()}
        </div>
    )
}

const STAT_SHARD_FALLBACK_BY_PERK_ID: {
    [perkId: number]: { name: string, description: string }
} = {
    5001: { name: `스탯 파편`, description: `공격 속도 +10%` },
    5005: { name: `스탯 파편`, description: `적응형 능력치 +9` },
    5007: { name: `스탯 파편`, description: `스킬 가속 +8` },
    5008: { name: `스탯 파편`, description: `이동 속도 +2%` },
    5010: { name: `스탯 파편`, description: `체력 +10~180 (레벨에 따라 증가)` },
    5011: { name: `스탯 파편`, description: `강인함 +10% / 둔화 저항 +15%` },
}

const STAT_SHARD_PRESENTATION_BY_PERK_ID: {
    [perkId: number]: { glyph: string, tone: `offense` | `utility` | `defense` }
} = {
    5001: { glyph: `AS`, tone: `offense` },
    5005: { glyph: `AF`, tone: `offense` },
    5007: { glyph: `AH`, tone: `utility` },
    5008: { glyph: `MS`, tone: `utility` },
    5010: { glyph: `HP`, tone: `defense` },
    5011: { glyph: `TEN`, tone: `defense` },
}
const SUMMONERS_RIFT_BASE_RESPAWN_SECONDS_BY_LEVEL = [
    0,
    10,
    10,
    12,
    12,
    14,
    16,
    20,
    25,
    28,
    32.5,
    35,
    37.5,
    40,
    42.5,
    45,
    47.5,
    50,
    52.5,
]

function getElapsedGameTimeSeconds(startTimestamp: string, currentTimestamp: string) {
    const startMs = Date.parse(startTimestamp)
    const currentMs = Date.parse(currentTimestamp)
    if (!Number.isFinite(startMs) || !Number.isFinite(currentMs)) return 0
    return Math.max(0, Math.floor((currentMs - startMs) / 1000))
}

function getEstimatedRespawnSeconds(level: number, elapsedGameTimeSeconds: number) {
    const boundedLevel = Math.min(18, Math.max(1, Math.floor(level)))
    const baseRespawnSeconds = SUMMONERS_RIFT_BASE_RESPAWN_SECONDS_BY_LEVEL[boundedLevel]
    const timeIncreaseFactor = getSummonersRiftRespawnTimeIncreaseFactor(elapsedGameTimeSeconds)
    const estimatedRespawnSeconds = baseRespawnSeconds + baseRespawnSeconds * timeIncreaseFactor
    return Math.max(1, Math.ceil(estimatedRespawnSeconds))
}

function getSummonersRiftRespawnTimeIncreaseFactor(elapsedGameTimeSeconds: number) {
    const elapsedGameMinutes = Math.max(0, elapsedGameTimeSeconds) / 60
    if (elapsedGameMinutes < 15) return 0

    if (elapsedGameMinutes < 30) {
        const halfMinuteSteps = Math.ceil(2 * (elapsedGameMinutes - 15))
        return Math.min(0.5, (halfMinuteSteps * 0.425) / 100)
    }

    if (elapsedGameMinutes < 45) {
        const halfMinuteSteps = Math.ceil(2 * (elapsedGameMinutes - 30))
        const factor = (12.75 + halfMinuteSteps * 0.3) / 100
        return Math.min(0.5, factor)
    }

    if (elapsedGameMinutes < 55) {
        const halfMinuteSteps = Math.ceil(2 * (elapsedGameMinutes - 45))
        const factor = (21.75 + halfMinuteSteps * 1.45) / 100
        return Math.min(0.5, factor)
    }

    return 0.5
}

function areNumericRecordValuesEqual(
    left: { [key: number]: number },
    right: { [key: number]: number },
) {
    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)
    if (leftKeys.length !== rightKeys.length) return false

    return leftKeys.every((key) => left[Number(key)] === right[Number(key)])
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

function getFormattedGoldDifference(goldDifference: number) {
    const formattedDifference = Number(Math.abs(goldDifference)).toLocaleString("en-us")
    const sign = goldDifference > 0 ? `+` : goldDifference < 0 ? `-` : ``
    return `(${sign}${formattedDifference})`
}

function getDragonSVG(dragonName: string, teamColor: string, index: number) {
    const normalizedDragonName = normalizeDragonType(dragonName)
    let key = `${teamColor}_${index}_${normalizedDragonName}`
    switch (normalizedDragonName) {
        case "ocean": return <OceanDragonSVG className="dragon" key={key} />;
        case "hextech": return <HextechDragonSVG className="dragon" key={key} />;
        case "chemtech": return <ChemtechDragonSVG className="dragon" key={key} />;
        case "infernal": return <InfernalDragonSVG className="dragon" key={key} />
        case "cloud": return <CloudDragonSVG className="dragon" key={key} />
        case "mountain": return <MountainDragonSVG className="dragon" key={key} />
        case "elder": return <ElderDragonSVG className="dragon" key={key} />
    }
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

function formatGoldInK(goldValue: number) {
    const normalizedK = Number(goldValue) / 1000
    const roundedK = Math.round(normalizedK * 10) / 10
    const displayValue = Number.isInteger(roundedK) ? roundedK.toFixed(0) : roundedK.toFixed(1)
    return `${displayValue}k`
}

function formatTeamGoldInK(goldValue: number) {
    const normalizedK = Number(goldValue) / 1000
    return `${normalizedK.toFixed(1)}k`
}

function getBaronPowerPlayClassName(teamKey: TeamKey) {
    return teamKey === `blue` ? `team-blue` : `team-red`
}

function formatBaronPowerPlayValue(baronPowerPlay: number | null) {
    if (baronPowerPlay === null) return ``
    return `${baronPowerPlay > 0 ? `+` : ``}${Number(baronPowerPlay).toLocaleString(`en-us`)}`
}

function formatBaronPowerPlayRemainingTime(remainingSeconds: number | null) {
    if (remainingSeconds === null) return ``
    const safeSeconds = Math.max(0, remainingSeconds)
    const minutes = Math.floor(safeSeconds / 60)
    const seconds = safeSeconds % 60
    return `${minutes}:${String(seconds).padStart(2, `0`)}`
}

function formatCountdownSeconds(remainingSeconds: number) {
    const safeSeconds = Math.max(0, remainingSeconds)
    const minutes = Math.floor(safeSeconds / 60)
    const seconds = safeSeconds % 60
    return `${minutes}:${String(seconds).padStart(2, `0`)}`
}

function formatSpawnCountdownSeconds(remainingSeconds: number) {
    return `-${formatCountdownSeconds(remainingSeconds)}`
}

function getBaronObjectiveStatusLabel(
    elapsedGameTimeSeconds: number,
    currentFrameTimestampMs: number,
    lastBaronKillTimestampMs: number | null,
) {
    if (elapsedGameTimeSeconds < BARON_FIRST_SPAWN_SECONDS) return null
    if (!Number.isFinite(currentFrameTimestampMs)) return null
    if (lastBaronKillTimestampMs === null) return `LIVE`

    const elapsedSinceLastBaronKillSeconds = Math.max(0, Math.floor((currentFrameTimestampMs - lastBaronKillTimestampMs) / 1000))
    const remainingSeconds = BARON_RESPAWN_SECONDS - elapsedSinceLastBaronKillSeconds
    if (remainingSeconds <= 0) return `LIVE`

    return formatSpawnCountdownSeconds(remainingSeconds)
}

function getHeraldObjectiveStatusLabel(
    elapsedGameTimeSeconds: number,
    hasHeraldBeenKilled: boolean,
) {
    if (hasHeraldBeenKilled) return null
    if (elapsedGameTimeSeconds < HERALD_FIRST_SPAWN_SECONDS) {
        return formatSpawnCountdownSeconds(HERALD_FIRST_SPAWN_SECONDS - elapsedGameTimeSeconds)
    }
    if (elapsedGameTimeSeconds < BARON_FIRST_SPAWN_SECONDS) return `LIVE`
    return null
}

function getBaronPreSpawnStatusLabel(elapsedGameTimeSeconds: number) {
    if (elapsedGameTimeSeconds >= BARON_FIRST_SPAWN_SECONDS) return null
    return formatSpawnCountdownSeconds(BARON_FIRST_SPAWN_SECONDS - elapsedGameTimeSeconds)
}

function getDragonObjectiveStatusLabel(
    elapsedGameTimeSeconds: number,
    currentFrameTimestampMs: number,
    lastDragonKillTimestampMs: number | null,
    shouldUseElderDragonRespawnTimer: boolean,
) {
    if (elapsedGameTimeSeconds < DRAGON_FIRST_SPAWN_SECONDS) {
        return formatSpawnCountdownSeconds(DRAGON_FIRST_SPAWN_SECONDS - elapsedGameTimeSeconds)
    }
    if (!Number.isFinite(currentFrameTimestampMs)) return null
    if (lastDragonKillTimestampMs === null) return `LIVE`

    const elapsedSinceLastDragonKillSeconds = Math.max(0, Math.floor((currentFrameTimestampMs - lastDragonKillTimestampMs) / 1000))
    const dragonRespawnSeconds = shouldUseElderDragonRespawnTimer ? ELDER_DRAGON_RESPAWN_SECONDS : DRAGON_RESPAWN_SECONDS
    const remainingSeconds = dragonRespawnSeconds - elapsedSinceLastDragonKillSeconds
    if (remainingSeconds <= 0) return `LIVE`

    return formatSpawnCountdownSeconds(remainingSeconds)
}

function getDragonKillCount(windowFrame: WindowFrame) {
    const blueTeamDragonKillCount = Array.isArray(windowFrame.blueTeam.dragons) ? windowFrame.blueTeam.dragons.length : 0
    const redTeamDragonKillCount = Array.isArray(windowFrame.redTeam.dragons) ? windowFrame.redTeam.dragons.length : 0
    return blueTeamDragonKillCount + redTeamDragonKillCount
}

function normalizeDragonType(dragonType: string) {
    return String(dragonType || ``).trim().toLowerCase()
}

function isElderDragonType(dragonType: string) {
    const normalizedDragonType = normalizeDragonType(dragonType)
    return normalizedDragonType === `elder` || normalizedDragonType.includes(`elder`)
}

function getNormalizedDragonTypes(dragonTypes: string[] | undefined) {
    if (!Array.isArray(dragonTypes)) return []
    return dragonTypes.map((dragonType) => normalizeDragonType(dragonType)).filter(Boolean)
}

function getAddedDragonTypes(previousDragonTypes: string[], currentDragonTypes: string[]) {
    const previousTypeCounts = new Map<string, number>()
    previousDragonTypes.forEach((dragonType) => {
        previousTypeCounts.set(dragonType, (previousTypeCounts.get(dragonType) || 0) + 1)
    })

    const addedDragonTypes: string[] = []
    currentDragonTypes.forEach((dragonType) => {
        const existingCount = previousTypeCounts.get(dragonType) || 0
        if (existingCount > 0) {
            previousTypeCounts.set(dragonType, existingCount - 1)
            return
        }

        addedDragonTypes.push(dragonType)
    })

    return addedDragonTypes
}

function getTeamElementalDragonKillCount(dragonTypes: string[] | undefined) {
    if (!Array.isArray(dragonTypes)) return 0
    return dragonTypes.filter((dragonType) => !isElderDragonType(dragonType)).length
}

function getGoldLeadSymbol(goldLead: number) {
    if (goldLead > 0) return `\u25C0`
    if (goldLead < 0) return `\u25B6`
    return ``
}

function getLiveGameStateLabel(gameState: string) {
    switch (gameState) {
        case GameState.in_game:
            return `\uC9C4\uD589 \uC911`
        case GameState.paused:
            return `\uC77C\uC2DC\uC815\uC9C0`
        case GameState.finished:
            return `\uAC8C\uC784 \uC885\uB8CC`
        default:
            return gameState.toUpperCase()
    }
}

