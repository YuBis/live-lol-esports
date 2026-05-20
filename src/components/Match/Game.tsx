import './styles/playerStatusStyle.css'
import '../Schedule/styles/scheduleStyle.css'

import { GameDetails } from "./GameDetails"
import { MiniHealthBar } from "./MiniHealthBar";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
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
import OceanDragonSoulImage from '../../assets/images/dragon-ocean-soul.webp';
import HextechDragonSoulImage from '../../assets/images/dragon-hextech-soul.webp';
import ChemtechDragonSoulImage from '../../assets/images/dragon-chemtech-soul.webp';
import InfernalDragonSoulImage from '../../assets/images/dragon-infernal-soul.webp';
import CloudDragonSoulImage from '../../assets/images/dragon-cloud-soul.webp';
import MountainDragonSoulImage from '../../assets/images/dragon-mountain-soul.webp';
import { ItemsDisplay } from "./ItemsDisplay";

import { LiveAPIWatcher } from "./LiveAPIWatcher";
import { CHAMPIONS_URL, getFormattedPatchVersion } from '../../utils/LoLEsportsAPI';
import { BUILD_LABEL } from '../../utils/buildInfo';
import { TwitchEmbed, TwitchEmbedLayout } from 'twitch-player';
import { ChatToggler } from '../Navbar/ChatToggler';
import { StreamToggler } from '../Navbar/StreamToggler';
import {
    applyScoreboardLayoutBodyClassNames,
    getInitialScoreboardLayoutMode,
    isBasicCompactScoreboardLayoutMode,
    getScoreboardLayoutModeClassName,
    isMirrorScoreboardLayoutMode,
    parseScoreboardLayoutMode,
    SCOREBOARD_LAYOUT_MODE_LABELS,
    SCOREBOARD_LAYOUT_MODE_OPTIONS,
    SCOREBOARD_LAYOUT_MODE_STORAGE_KEY,
    ScoreboardLayoutMode,
} from './scoreboardLayout';

type Props = {
    firstWindowFrame: WindowFrame,
    lastWindowFrame: WindowFrame,
    playbackTimestamp?: string,
    windowFrameTimeline?: WindowFrame[],
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
    inferredHeraldKillTimestampByTeam?: { blue: string | null, red: string | null },
    objectiveTimerBackfillSeed?: ObjectiveTimerBackfillSeed,
    debugSimulationModeEnabled?: boolean,
    debugSimulationRunning?: boolean,
    onDebugSimulationModeChange?: (isEnabled: boolean) => void,
    onDebugSimulationToggle?: () => void,
    debugSimulationJumpMinutes?: number[],
    onDebugSimulationJumpToMinute?: (targetMinute: number) => void,
}

type TeamKey = `blue` | `red`
type DeathTimerSource = `death_transition` | `health_seed`
type ObjectiveBuffState = {
    baron: boolean,
    elder: boolean,
}
type ObjectiveBuffsByParticipantId = {
    [participantId: number]: ObjectiveBuffState,
}
type HighlightedPurchasedItemsByParticipantId = {
    [participantId: number]: number[],
}
type ObjectiveBuffParticipantIdsByTeam = {
    blue: Set<number>,
    red: Set<number>,
}
type BaronPowerPlaySnapshot = {
    baseLead: number,
    startedAtMs: number,
    lastValue: number,
    active: boolean,
}
type DragonIconRenderItem = {
    type: `dragon` | `soul`,
    dragonType: string,
}
type GoldLeadTimelinePoint = {
    elapsedSeconds: number,
    lead: number,
}
type GoldLeadGraphPoint = {
    x: number,
    y: number,
    elapsedSeconds: number,
    lead: number,
}
type GoldLeadGraphTick = {
    seconds: number,
    x: number,
    label: string,
}
type GoldGraphEventType = `dragon` | `herald` | `baron` | `tower`
type GoldLeadGraphEventMarker = {
    x: number,
    elapsedSeconds: number,
    team: TeamKey,
    type: GoldGraphEventType,
    count: number,
}
type GoldLeadGraphData = {
    points: GoldLeadGraphPoint[],
    ticks: GoldLeadGraphTick[],
    eventMarkers: GoldLeadGraphEventMarker[],
    linePath: string,
    positiveAreaPath: string,
    negativeAreaPath: string,
    zeroY: number,
    topLabel: string,
    bottomLabel: string,
}
type GoldGraphDimensions = {
    width: number,
    height: number,
    paddingTop: number,
    paddingRight: number,
    paddingBottom: number,
    paddingLeft: number,
    eventMarkerY: number,
    eventMarkerSize: number,
}

enum GameState {
    in_game = "in game",
    paused = "game paused",
    finished = "game ended"
}

const BARON_POWER_PLAY_DURATION_MS = 180 * 1000
const BARON_POWER_PLAY_BASELINE_GOLD = 1500
const BARON_FIRST_SPAWN_SECONDS = 20 * 60
const BARON_RESPAWN_SECONDS = 6 * 60
const HERALD_FIRST_SPAWN_SECONDS = 14 * 60
const DRAGON_FIRST_SPAWN_SECONDS = 5 * 60
const DRAGON_RESPAWN_SECONDS = 5 * 60
const ELDER_DRAGON_RESPAWN_SECONDS = 6 * 60
const ELDER_DRAGON_BUFF_DURATION_MS = 150 * 1000
const FORCE_BARON_UI_PREVIEW = false
const FORCE_OBJECTIVE_BUFF_HOLDER_PREVIEW = false
const FORCE_ITEM_PURCHASE_HIGHLIGHT_PREVIEW = false
const FORCE_LEVEL_UP_HIGHLIGHT_PREVIEW = false
const ITEM_PURCHASE_HIGHLIGHT_DURATION_MS = 2000
const LEVEL_UP_FLASH_DURATION_MS = 2000
const LEVEL_UP_FLASH_TARGET_LEVELS = [6, 11, 16]
const GOLD_GRAPH_SAMPLING_INTERVAL_MS = 12 * 1000
const GOLD_GRAPH_MIN_SIDE_RATIO = 0.2
const GOLD_GRAPH_DEFAULT_DIMENSIONS: GoldGraphDimensions = {
    width: 720,
    height: 180,
    paddingTop: 14,
    paddingRight: 16,
    paddingBottom: 34,
    paddingLeft: 44,
    eventMarkerY: 171,
    eventMarkerSize: 11,
}
const GOLD_GRAPH_MIRROR_DIMENSIONS: GoldGraphDimensions = {
    width: 720,
    height: 108,
    paddingTop: 8,
    paddingRight: 16,
    paddingBottom: 20,
    paddingLeft: 44,
    eventMarkerY: 101,
    eventMarkerSize: 9,
}
const DRAGON_SOUL_IMAGE_BY_TYPE: { [dragonType: string]: string } = {
    ocean: OceanDragonSoulImage,
    hextech: HextechDragonSoulImage,
    chemtech: ChemtechDragonSoulImage,
    infernal: InfernalDragonSoulImage,
    cloud: CloudDragonSoulImage,
    mountain: MountainDragonSoulImage,
}
const PURCHASE_HIGHLIGHT_UPGRADE_PAIRS = [
    [3003, 3040], // Archangel's Staff -> Seraph's Embrace
    [3004, 3042], // Manamune -> Muramana
    [3119, 3121], // Winter's Approach -> Fimbulwinter
    [2526, 2530], // Whispering Circlet -> Diadem of Songs
    [3009, 3170], // Boots of Swiftness -> Swiftmarch
    [3158, 3171], // Ionian Boots -> Crimson Lucidity
    [3006, 3172], // Berserker's Greaves -> Gunmetal Greaves
    [3111, 3173], // Mercury's Treads -> Chainlaced Crushers
    [3047, 3174], // Plated Steelcaps -> Armored Advance
    [3020, 3175], // Sorcerer's Shoes -> Spellslinger's Shoes
    [3008, 3168],
    [3010, 3013], // Symbiotic Soles -> Synchronized Souls
    [3013, 3176], // Synchronized Souls -> Forever Forward
] as const
const PURCHASE_HIGHLIGHT_TARGET_BY_SOURCE_ITEM_ID = new Map<number, number>(PURCHASE_HIGHLIGHT_UPGRADE_PAIRS)
const PURCHASE_HIGHLIGHT_REGISTERED_TARGET_ITEM_IDS = new Set<number>(
    PURCHASE_HIGHLIGHT_UPGRADE_PAIRS.map(([, targetItemId]) => targetItemId),
)
const PURCHASE_HIGHLIGHT_TRINKET_ITEM_IDS = [3330, 3340, 3348, 3349, 3363, 3364, 6702]
const PURCHASE_HIGHLIGHT_FALLBACK_CONSUMABLE_ITEM_IDS = [2003, 2010, 2031, 2033, 2055, 2138, 2139, 2140]

export function Game({ firstWindowFrame, lastWindowFrame, playbackTimestamp, windowFrameTimeline, lastDetailsFrame, gameMetadata, gameIndex, eventDetails, outcome, results, items, runes, championNameMap, backfillStatus = `idle`, inferredHeraldKillCounts = { blue: 0, red: 0 }, inferredHeraldKillTimestampByTeam = { blue: null, red: null }, objectiveTimerBackfillSeed, debugSimulationModeEnabled = false, debugSimulationRunning = false, onDebugSimulationModeChange, onDebugSimulationToggle, debugSimulationJumpMinutes = [], onDebugSimulationJumpToMinute }: Props) {
    const [gameState, setGameState] = useState<GameState>(GameState[lastWindowFrame.gameState as keyof typeof GameState]);
    const [videoProvider, setVideoProvider] = useState<string>();
    const [videoParameter, setVideoParameter] = useState<string>();
    const [scoreboardLayoutMode, setScoreboardLayoutMode] = useState<ScoreboardLayoutMode>(() => getInitialScoreboardLayoutMode())
    const [kdaFlashByCell, setKdaFlashByCell] = useState<{ [cellKey: string]: boolean }>({})
    const [deathTimerSecondsByParticipantId, setDeathTimerSecondsByParticipantId] = useState<{ [participantId: number]: number }>({})
    const [selectedRuneKeyByParticipantId, setSelectedRuneKeyByParticipantId] = useState<{ [participantId: number]: string }>({})
    const [mirrorExpandedParticipantIds, setMirrorExpandedParticipantIds] = useState<number[]>([])
    const [baronPowerPlayByTeam, setBaronPowerPlayByTeam] = useState<{ blue: number | null, red: number | null }>({ blue: null, red: null })
    const [baronPowerPlayRemainingSecondsByTeam, setBaronPowerPlayRemainingSecondsByTeam] = useState<{ blue: number | null, red: number | null }>({ blue: null, red: null })
    const [elderBuffRemainingSecondsByTeam, setElderBuffRemainingSecondsByTeam] = useState<{ blue: number | null, red: number | null }>({ blue: null, red: null })
    const [objectiveBuffsByParticipantId, setObjectiveBuffsByParticipantId] = useState<ObjectiveBuffsByParticipantId>({})
    const [highlightedPurchasedItemsByParticipantId, setHighlightedPurchasedItemsByParticipantId] = useState<HighlightedPurchasedItemsByParticipantId>({})
    const [levelFlashByParticipantId, setLevelFlashByParticipantId] = useState<{ [participantId: number]: boolean }>({})
    const [isGoldGraphVisible, setIsGoldGraphVisible] = useState<boolean>(false)
    const previousKdaByParticipantIdRef = useRef<Map<number, { kills: number, deaths: number, assists: number }>>(new Map())
    const previousLevelByParticipantIdRef = useRef<Map<number, number>>(new Map())
    const previousVitalsByParticipantIdRef = useRef<Map<number, { deaths: number, currentHealth: number }>>(new Map())
    const deathTimerEndAtMsByParticipantIdRef = useRef<Map<number, number>>(new Map())
    const deathTimerSourceByParticipantIdRef = useRef<Map<number, DeathTimerSource>>(new Map())
    const flashClearTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
    const levelFlashClearTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())
    const previousItemIdsByParticipantIdRef = useRef<Map<number, number[]>>(new Map())
    const itemPurchaseHighlightTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
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
    const elderBuffEndAtMsByTeamRef = useRef<{ blue: number | null, red: number | null }>({
        blue: null,
        red: null,
    })
    const baronBuffParticipantIdsByTeamRef = useRef<ObjectiveBuffParticipantIdsByTeam>({
        blue: new Set<number>(),
        red: new Set<number>(),
    })
    const elderBuffParticipantIdsByTeamRef = useRef<ObjectiveBuffParticipantIdsByTeam>({
        blue: new Set<number>(),
        red: new Set<number>(),
    })
    const hasAppliedObjectiveTimerBackfillRef = useRef<boolean>(false)
    const lastBaronKillTimestampMsRef = useRef<number | null>(null)
    const lastDragonKillTimestampMsRef = useRef<number | null>(null)
    const lastProcessedObjectiveFrameTimestampMsRef = useRef<number | null>(null)
    const chatData = localStorage.getItem("chat");
    const chatEnabled = chatData ? chatData === `unmute` : false
    const streamData = localStorage.getItem("stream");
    const streamEnabled = streamData ? streamData === `unmute` : false
    const effectiveLastWindowTimestamp = playbackTimestamp || lastWindowFrame.rfc460Timestamp
    const isSimulationInProgress = debugSimulationModeEnabled && debugSimulationRunning

    useEffect(() => {
        return applyScoreboardLayoutBodyClassNames(scoreboardLayoutMode)
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
        const levelFlashClearTimers = levelFlashClearTimersRef.current
        const itemPurchaseHighlightTimers = itemPurchaseHighlightTimersRef.current
        return () => {
            flashClearTimers.forEach((timerId) => clearTimeout(timerId))
            flashClearTimers.clear()
            levelFlashClearTimers.forEach((timerId) => clearTimeout(timerId))
            levelFlashClearTimers.clear()
            itemPurchaseHighlightTimers.forEach((timerId) => clearTimeout(timerId))
            itemPurchaseHighlightTimers.clear()
        }
    }, [])

    useEffect(() => {
        const frameTimestampMs = Date.parse(effectiveLastWindowTimestamp)
        if (!Number.isFinite(frameTimestampMs)) return
        const participantsById = new Map<number, WindowParticipant>(
            [...lastWindowFrame.blueTeam.participants, ...lastWindowFrame.redTeam.participants]
                .map((participant) => [participant.participantId, participant]),
        )

        const effectiveFrameTimestampMs = frameTimestampMs
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
                deathTimerSourceByParticipantIdRef.current.delete(participantId)
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
        effectiveLastWindowTimestamp,
        lastWindowFrame.blueTeam.participants,
        lastWindowFrame.redTeam.participants,
    ])

    useEffect(() => {
        previousKdaByParticipantIdRef.current.clear()
        previousLevelByParticipantIdRef.current.clear()
        previousVitalsByParticipantIdRef.current.clear()
        deathTimerEndAtMsByParticipantIdRef.current.clear()
        deathTimerSourceByParticipantIdRef.current.clear()
        setKdaFlashByCell({})
        setLevelFlashByParticipantId({})
        setDeathTimerSecondsByParticipantId({})
        setSelectedRuneKeyByParticipantId({})
        setMirrorExpandedParticipantIds([])
        setBaronPowerPlayByTeam({ blue: null, red: null })
        setBaronPowerPlayRemainingSecondsByTeam({ blue: null, red: null })
        setElderBuffRemainingSecondsByTeam({ blue: null, red: null })
        setObjectiveBuffsByParticipantId({})
        setHighlightedPurchasedItemsByParticipantId({})
        levelFlashClearTimersRef.current.forEach((timerId) => clearTimeout(timerId))
        levelFlashClearTimersRef.current.clear()
        previousItemIdsByParticipantIdRef.current.clear()
        itemPurchaseHighlightTimersRef.current.forEach((timerId) => clearTimeout(timerId))
        itemPurchaseHighlightTimersRef.current.clear()
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
        baronBuffParticipantIdsByTeamRef.current = { blue: new Set<number>(), red: new Set<number>() }
        elderBuffParticipantIdsByTeamRef.current = { blue: new Set<number>(), red: new Set<number>() }
        hasAppliedObjectiveTimerBackfillRef.current = false
        lastBaronKillTimestampMsRef.current = null
        lastDragonKillTimestampMsRef.current = null
        lastProcessedObjectiveFrameTimestampMsRef.current = null
    }, [gameIndex, firstWindowFrame.rfc460Timestamp])

    useEffect(() => {
        if (!objectiveTimerBackfillSeed || hasAppliedObjectiveTimerBackfillRef.current) return

        const frameTimestampMs = Date.parse(effectiveLastWindowTimestamp)
        if (!Number.isFinite(frameTimestampMs)) return

        const seededLastBaronKillTimestampMs = objectiveTimerBackfillSeed.lastBaronKillTimestampMs
        const seededLastDragonKillTimestampMs = objectiveTimerBackfillSeed.lastDragonKillTimestampMs
        lastBaronKillTimestampMsRef.current = (
            seededLastBaronKillTimestampMs !== null
            && seededLastBaronKillTimestampMs <= frameTimestampMs
        ) ? seededLastBaronKillTimestampMs : null
        lastDragonKillTimestampMsRef.current = (
            seededLastDragonKillTimestampMs !== null
            && seededLastDragonKillTimestampMs <= frameTimestampMs
        ) ? seededLastDragonKillTimestampMs : null

        const blueTeamLead = Number(lastWindowFrame.blueTeam.totalGold || 0) - Number(lastWindowFrame.redTeam.totalGold || 0)
        const redTeamLead = -blueTeamLead
        const nextPowerPlayByTeam: { blue: number | null, red: number | null } = { blue: null, red: null }
        const nextPowerPlayRemainingSecondsByTeam: { blue: number | null, red: number | null } = { blue: null, red: null }

        ;([`blue`, `red`] as TeamKey[]).forEach((teamKey) => {
            const seedSnapshot = objectiveTimerBackfillSeed.baronPowerPlaySnapshotByTeam[teamKey]
            if (!seedSnapshot) {
                baronPowerPlaySnapshotByTeamRef.current[teamKey] = null
                baronBuffParticipantIdsByTeamRef.current[teamKey] = new Set<number>()
                return
            }

            // Backfill seed may describe a later baron than the current replay frame.
            // In that case, keep this team inactive until the replay reaches start time.
            if (frameTimestampMs < seedSnapshot.startedAtMs) {
                baronPowerPlaySnapshotByTeamRef.current[teamKey] = null
                baronBuffParticipantIdsByTeamRef.current[teamKey] = new Set<number>()
                return
            }

            const elapsedMs = Math.max(0, frameTimestampMs - seedSnapshot.startedAtMs)
            if (elapsedMs >= BARON_POWER_PLAY_DURATION_MS) {
                baronPowerPlaySnapshotByTeamRef.current[teamKey] = null
                baronBuffParticipantIdsByTeamRef.current[teamKey] = new Set<number>()
                return
            }

            const currentLead = teamKey === `blue` ? blueTeamLead : redTeamLead
            const teamParticipants = teamKey === `blue` ? lastWindowFrame.blueTeam.participants : lastWindowFrame.redTeam.participants
            const seededBaronBuffParticipantIds = objectiveTimerBackfillSeed.baronBuffParticipantIdsByTeam?.[teamKey]
            const baronBuffParticipantIds = Array.isArray(seededBaronBuffParticipantIds)
                ? new Set<number>(seededBaronBuffParticipantIds)
                : getAliveParticipantIdSet(teamParticipants)
            if (baronBuffParticipantIds.size === 0) {
                baronPowerPlaySnapshotByTeamRef.current[teamKey] = null
                baronBuffParticipantIdsByTeamRef.current[teamKey] = new Set<number>()
                return
            }
            const powerPlayValue = Math.round((currentLead - seedSnapshot.baseLead) + BARON_POWER_PLAY_BASELINE_GOLD)
            nextPowerPlayByTeam[teamKey] = powerPlayValue
            nextPowerPlayRemainingSecondsByTeam[teamKey] = Math.max(0, Math.ceil((BARON_POWER_PLAY_DURATION_MS - elapsedMs) / 1000))
            baronBuffParticipantIdsByTeamRef.current[teamKey] = baronBuffParticipantIds

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
            if (!elderBuffEndAtMs) {
                elderBuffParticipantIdsByTeamRef.current[teamKey] = new Set<number>()
                return
            }

            const elderBuffStartAtMs = elderBuffEndAtMs - ELDER_DRAGON_BUFF_DURATION_MS
            if (frameTimestampMs < elderBuffStartAtMs) {
                elderBuffParticipantIdsByTeamRef.current[teamKey] = new Set<number>()
                return
            }

            const remainingSeconds = Math.max(0, Math.ceil((elderBuffEndAtMs - frameTimestampMs) / 1000))
            if (remainingSeconds <= 0) {
                elderBuffEndAtMsByTeamRef.current[teamKey] = null
                elderBuffParticipantIdsByTeamRef.current[teamKey] = new Set<number>()
                return
            }
            const teamParticipants = teamKey === `blue` ? lastWindowFrame.blueTeam.participants : lastWindowFrame.redTeam.participants
            const seededElderBuffParticipantIds = objectiveTimerBackfillSeed.elderBuffParticipantIdsByTeam?.[teamKey]
            const elderBuffParticipantIds = Array.isArray(seededElderBuffParticipantIds)
                ? new Set<number>(seededElderBuffParticipantIds)
                : getAliveParticipantIdSet(teamParticipants)
            if (elderBuffParticipantIds.size === 0) {
                elderBuffEndAtMsByTeamRef.current[teamKey] = null
                elderBuffParticipantIdsByTeamRef.current[teamKey] = new Set<number>()
                return
            }
            elderBuffParticipantIdsByTeamRef.current[teamKey] = elderBuffParticipantIds
            nextElderBuffRemainingSecondsByTeam[teamKey] = remainingSeconds
        })
        setElderBuffRemainingSecondsByTeam(nextElderBuffRemainingSecondsByTeam)
        setObjectiveBuffsByParticipantId(buildObjectiveBuffsByParticipantId(
            baronBuffParticipantIdsByTeamRef.current,
            elderBuffParticipantIdsByTeamRef.current,
        ))

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
        effectiveLastWindowTimestamp,
        lastWindowFrame.blueTeam.totalGold,
        lastWindowFrame.redTeam.totalGold,
        lastWindowFrame.blueTeam.barons,
        lastWindowFrame.redTeam.barons,
        lastWindowFrame.blueTeam.dragons,
        lastWindowFrame.redTeam.dragons,
    ])

    useEffect(() => {
        const frameTimestampMs = Date.parse(effectiveLastWindowTimestamp)
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
            elderBuffParticipantIdsByTeamRef.current.blue = getAliveParticipantIdSet(lastWindowFrame.blueTeam.participants)
        }
        if (redElderKillDetected) {
            elderBuffEndAtMsByTeamRef.current.red = frameTimestampMs + ELDER_DRAGON_BUFF_DURATION_MS
            elderBuffParticipantIdsByTeamRef.current.red = getAliveParticipantIdSet(lastWindowFrame.redTeam.participants)
        }

        if (blueBaronKillDetected) {
            baronPowerPlaySnapshotByTeamRef.current.blue = {
                baseLead: blueTeamLead,
                startedAtMs: frameTimestampMs,
                lastValue: 0,
                active: true,
            }
            baronBuffParticipantIdsByTeamRef.current.blue = getAliveParticipantIdSet(lastWindowFrame.blueTeam.participants)
        }

        if (redBaronKillDetected) {
            baronPowerPlaySnapshotByTeamRef.current.red = {
                baseLead: redTeamLead,
                startedAtMs: frameTimestampMs,
                lastValue: 0,
                active: true,
            }
            baronBuffParticipantIdsByTeamRef.current.red = getAliveParticipantIdSet(lastWindowFrame.redTeam.participants)
        }

        const nextPowerPlayByTeam: { blue: number | null, red: number | null } = { blue: null, red: null }
        const nextRemainingSecondsByTeam: { blue: number | null, red: number | null } = { blue: null, red: null }
        ;([`blue`, `red`] as TeamKey[]).forEach((teamKey) => {
            const snapshot = baronPowerPlaySnapshotByTeamRef.current[teamKey]
            if (!snapshot) return

            const elapsedMs = Math.max(0, frameTimestampMs - snapshot.startedAtMs)
            if (elapsedMs >= BARON_POWER_PLAY_DURATION_MS || baronBuffParticipantIdsByTeamRef.current[teamKey].size === 0) {
                snapshot.active = false
                baronPowerPlaySnapshotByTeamRef.current[teamKey] = null
                baronBuffParticipantIdsByTeamRef.current[teamKey] = new Set<number>()
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
            if (remainingSeconds <= 0 || elderBuffParticipantIdsByTeamRef.current[teamKey].size === 0) {
                elderBuffEndAtMsByTeamRef.current[teamKey] = null
                elderBuffParticipantIdsByTeamRef.current[teamKey] = new Set<number>()
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
        setObjectiveBuffsByParticipantId(buildObjectiveBuffsByParticipantId(
            baronBuffParticipantIdsByTeamRef.current,
            elderBuffParticipantIdsByTeamRef.current,
        ))
    }, [
        effectiveLastWindowTimestamp,
        lastWindowFrame.blueTeam.totalGold,
        lastWindowFrame.redTeam.totalGold,
        lastWindowFrame.blueTeam.barons,
        lastWindowFrame.redTeam.barons,
        lastWindowFrame.blueTeam.dragons,
        lastWindowFrame.redTeam.dragons,
        lastWindowFrame.blueTeam.dragons.length,
        lastWindowFrame.redTeam.dragons.length,
        lastWindowFrame.blueTeam.participants,
        lastWindowFrame.redTeam.participants,
    ])

    useEffect(() => {
        const frameTimestampMs = Date.parse(effectiveLastWindowTimestamp)
        if (!Number.isFinite(frameTimestampMs)) return

        const effectiveFrameTimestampMs = frameTimestampMs
        const blueTeamLead = Number(lastWindowFrame.blueTeam.totalGold || 0) - Number(lastWindowFrame.redTeam.totalGold || 0)
        const redTeamLead = -blueTeamLead

        const nextPowerPlayByTeam: { blue: number | null, red: number | null } = { blue: null, red: null }
        const nextRemainingSecondsByTeam: { blue: number | null, red: number | null } = { blue: null, red: null }
        ;([`blue`, `red`] as TeamKey[]).forEach((teamKey) => {
            const snapshot = baronPowerPlaySnapshotByTeamRef.current[teamKey]
            if (!snapshot) return

            const elapsedMs = Math.max(0, effectiveFrameTimestampMs - snapshot.startedAtMs)
            if (elapsedMs >= BARON_POWER_PLAY_DURATION_MS || baronBuffParticipantIdsByTeamRef.current[teamKey].size === 0) {
                baronPowerPlaySnapshotByTeamRef.current[teamKey] = null
                baronBuffParticipantIdsByTeamRef.current[teamKey] = new Set<number>()
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
            if (remainingSeconds <= 0 || elderBuffParticipantIdsByTeamRef.current[teamKey].size === 0) {
                elderBuffEndAtMsByTeamRef.current[teamKey] = null
                elderBuffParticipantIdsByTeamRef.current[teamKey] = new Set<number>()
                return
            }
            nextElderBuffRemainingSecondsByTeam[teamKey] = remainingSeconds
        })

        setElderBuffRemainingSecondsByTeam((previousState) => (
            previousState.blue === nextElderBuffRemainingSecondsByTeam.blue
            && previousState.red === nextElderBuffRemainingSecondsByTeam.red
        ) ? previousState : nextElderBuffRemainingSecondsByTeam)
        setObjectiveBuffsByParticipantId(buildObjectiveBuffsByParticipantId(
            baronBuffParticipantIdsByTeamRef.current,
            elderBuffParticipantIdsByTeamRef.current,
        ))
    }, [
        effectiveLastWindowTimestamp,
        lastWindowFrame.blueTeam.totalGold,
        lastWindowFrame.redTeam.totalGold,
    ])

    useEffect(() => {
        const flashCellKeys: string[] = []
        const levelFlashParticipantIds: number[] = []
        const participants = [
            ...lastWindowFrame.blueTeam.participants,
            ...lastWindowFrame.redTeam.participants,
        ]
        const frameTimestampMs = Date.parse(effectiveLastWindowTimestamp)
        const normalizedFrameTimestampMs = Number.isFinite(frameTimestampMs) ? frameTimestampMs : Date.now()
        const elapsedGameTimeSeconds = getElapsedGameTimeSeconds(firstWindowFrame.rfc460Timestamp, effectiveLastWindowTimestamp)
        let objectiveBuffsChanged = false

        participants.forEach((participant) => {
            let hasActiveDeathTimer = deathTimerEndAtMsByParticipantIdRef.current.has(participant.participantId)
            const previousVitals = previousVitalsByParticipantIdRef.current.get(participant.participantId)
            const hasDeathTransition = Boolean(previousVitals && participant.deaths > previousVitals.deaths)
            if (hasDeathTransition) {
                const estimatedRespawnSeconds = getEstimatedRespawnSeconds(participant.level, elapsedGameTimeSeconds)
                deathTimerEndAtMsByParticipantIdRef.current.set(
                    participant.participantId,
                    normalizedFrameTimestampMs + estimatedRespawnSeconds * 1000,
                )
                deathTimerSourceByParticipantIdRef.current.set(participant.participantId, `death_transition`)
                hasActiveDeathTimer = true
                objectiveBuffsChanged = removeParticipantObjectiveBuffs(
                    participant.participantId,
                    baronBuffParticipantIdsByTeamRef.current,
                    elderBuffParticipantIdsByTeamRef.current,
                ) || objectiveBuffsChanged
            }

            if (participant.currentHealth <= 0 && participant.deaths > 0 && !hasActiveDeathTimer) {
                // Refresh/reconnect can land mid-death without a detected death transition.
                // Seed an estimated timer so dead players do not appear without countdown.
                const estimatedRespawnSeconds = getEstimatedRespawnSeconds(participant.level, elapsedGameTimeSeconds)
                deathTimerEndAtMsByParticipantIdRef.current.set(
                    participant.participantId,
                    normalizedFrameTimestampMs + estimatedRespawnSeconds * 1000,
                )
                deathTimerSourceByParticipantIdRef.current.set(participant.participantId, `health_seed`)
            }
            if (participant.currentHealth <= 0 && participant.deaths > 0) {
                objectiveBuffsChanged = removeParticipantObjectiveBuffs(
                    participant.participantId,
                    baronBuffParticipantIdsByTeamRef.current,
                    elderBuffParticipantIdsByTeamRef.current,
                ) || objectiveBuffsChanged
            }

            const deathTimerSource = deathTimerSourceByParticipantIdRef.current.get(participant.participantId)
            if (participant.currentHealth > 0 && deathTimerSource !== `death_transition`) {
                deathTimerEndAtMsByParticipantIdRef.current.delete(participant.participantId)
                deathTimerSourceByParticipantIdRef.current.delete(participant.participantId)
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

            const previousLevel = previousLevelByParticipantIdRef.current.get(participant.participantId)
            if (
                previousLevel !== undefined
                && participant.level > previousLevel
                && LEVEL_UP_FLASH_TARGET_LEVELS.includes(participant.level)
            ) {
                levelFlashParticipantIds.push(participant.participantId)
            }
            previousLevelByParticipantIdRef.current.set(participant.participantId, participant.level)
        })

        const baronPowerPlayEndedByBuffLoss = clearHolderlessBaronPowerPlaySnapshots(
            baronPowerPlaySnapshotByTeamRef.current,
            baronBuffParticipantIdsByTeamRef.current,
        )
        const elderBuffEndedByBuffLoss = clearHolderlessElderBuffs(
            elderBuffEndAtMsByTeamRef.current,
            elderBuffParticipantIdsByTeamRef.current,
        )

        if (baronPowerPlayEndedByBuffLoss) {
            setBaronPowerPlayByTeam((previousState) => ({
                blue: baronPowerPlaySnapshotByTeamRef.current.blue ? previousState.blue : null,
                red: baronPowerPlaySnapshotByTeamRef.current.red ? previousState.red : null,
            }))
            setBaronPowerPlayRemainingSecondsByTeam((previousState) => ({
                blue: baronPowerPlaySnapshotByTeamRef.current.blue ? previousState.blue : null,
                red: baronPowerPlaySnapshotByTeamRef.current.red ? previousState.red : null,
            }))
        }
        if (elderBuffEndedByBuffLoss) {
            setElderBuffRemainingSecondsByTeam((previousState) => ({
                blue: elderBuffEndAtMsByTeamRef.current.blue ? previousState.blue : null,
                red: elderBuffEndAtMsByTeamRef.current.red ? previousState.red : null,
            }))
        }

        if (objectiveBuffsChanged || baronPowerPlayEndedByBuffLoss || elderBuffEndedByBuffLoss) {
            setObjectiveBuffsByParticipantId(buildObjectiveBuffsByParticipantId(
                baronBuffParticipantIdsByTeamRef.current,
                elderBuffParticipantIdsByTeamRef.current,
            ))
        }
        if (levelFlashParticipantIds.length > 0) {
            setLevelFlashByParticipantId((previousState) => {
                const nextState = { ...previousState }
                levelFlashParticipantIds.forEach((participantId) => {
                    nextState[participantId] = false
                })
                return nextState
            })

            requestAnimationFrame(() => {
                setLevelFlashByParticipantId((previousState) => {
                    const nextState = { ...previousState }
                    levelFlashParticipantIds.forEach((participantId) => {
                        nextState[participantId] = true
                    })
                    return nextState
                })
            })

            levelFlashParticipantIds.forEach((participantId) => {
                const existingTimerId = levelFlashClearTimersRef.current.get(participantId)
                if (existingTimerId) {
                    clearTimeout(existingTimerId)
                }

                const timerId = setTimeout(() => {
                    setLevelFlashByParticipantId((previousState) => {
                        if (!previousState[participantId]) return previousState
                        const nextState = { ...previousState }
                        delete nextState[participantId]
                        return nextState
                    })
                    levelFlashClearTimersRef.current.delete(participantId)
                }, LEVEL_UP_FLASH_DURATION_MS)
                levelFlashClearTimersRef.current.set(participantId, timerId)
            })
        }
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
            }, 3000)
            flashClearTimersRef.current.set(cellKey, timerId)
        })
    }, [
        firstWindowFrame.rfc460Timestamp,
        effectiveLastWindowTimestamp,
        lastWindowFrame.blueTeam.participants,
        lastWindowFrame.redTeam.participants,
    ])

    useEffect(() => {
        const highlightedPurchases: Array<{ participantId: number, itemId: number }> = []

        lastDetailsFrame.participants.forEach((participant) => {
            const currentItemIds = sanitizeDetailsItemIds(participant.items)
            const previousItemIds = previousItemIdsByParticipantIdRef.current.get(participant.participantId)

            if (!previousItemIds) {
                previousItemIdsByParticipantIdRef.current.set(participant.participantId, currentItemIds)
                return
            }

            const addedItemIds = getAddedItemIdsByCount(previousItemIds, currentItemIds)
            addedItemIds.forEach((addedItemId) => {
                const highlightItemId = getMajorPurchaseHighlightItemId(addedItemId, currentItemIds, items)
                if (highlightItemId === undefined) return
                highlightedPurchases.push({
                    participantId: participant.participantId,
                    itemId: highlightItemId,
                })
            })

            previousItemIdsByParticipantIdRef.current.set(participant.participantId, currentItemIds)
        })

        if (highlightedPurchases.length === 0) return

        setHighlightedPurchasedItemsByParticipantId((previousState) => {
            const nextState: HighlightedPurchasedItemsByParticipantId = { ...previousState }
            highlightedPurchases.forEach(({ participantId, itemId }) => {
                const existingItemIds = nextState[participantId] || []
                if (existingItemIds.includes(itemId)) return
                nextState[participantId] = [...existingItemIds, itemId]
            })
            return nextState
        })

        highlightedPurchases.forEach(({ participantId, itemId }) => {
            const highlightKey = `${participantId}_${itemId}`
            const existingTimerId = itemPurchaseHighlightTimersRef.current.get(highlightKey)
            if (existingTimerId) {
                clearTimeout(existingTimerId)
            }

            const timerId = setTimeout(() => {
                setHighlightedPurchasedItemsByParticipantId((previousState) => {
                    const existingItemIds = previousState[participantId]
                    if (!existingItemIds || !existingItemIds.includes(itemId)) return previousState

                    const remainingItemIds = existingItemIds.filter((highlightedItemId) => highlightedItemId !== itemId)
                    const nextState = { ...previousState }
                    if (remainingItemIds.length === 0) {
                        delete nextState[participantId]
                    } else {
                        nextState[participantId] = remainingItemIds
                    }
                    return nextState
                })
                itemPurchaseHighlightTimersRef.current.delete(highlightKey)
            }, ITEM_PURCHASE_HIGHLIGHT_DURATION_MS)
            itemPurchaseHighlightTimersRef.current.set(highlightKey, timerId)
        })
    }, [
        lastDetailsFrame.rfc460Timestamp,
        lastDetailsFrame.participants,
        items,
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
    const blueTeamKillDisplayValue = getTeamKillCountFromParticipants(lastWindowFrame.blueTeam.participants)
    const redTeamKillDisplayValue = getTeamKillCountFromParticipants(lastWindowFrame.redTeam.participants)
    const goldLeadSymbolAlignmentClass = goldLead > 0 ? `gold-lead-symbol-left` : goldLead < 0 ? `gold-lead-symbol-right` : ``
    const goldLeadColorClass = goldLead > 0 ? `gold-advantage-blue` : goldLead < 0 ? `gold-advantage-red` : `gold-advantage-neutral`
    const isMirrorLayoutForGraph = isMirrorScoreboardLayoutMode(scoreboardLayoutMode)
    const goldGraphDimensions = isMirrorLayoutForGraph
        ? GOLD_GRAPH_MIRROR_DIMENSIONS
        : GOLD_GRAPH_DEFAULT_DIMENSIONS
    const goldLeadTimelineFrames = useMemo(() => {
        const sourceFrames = (windowFrameTimeline && windowFrameTimeline.length > 0)
            ? windowFrameTimeline
            : [firstWindowFrame, lastWindowFrame]
        const graphCutoffTimestamp = isSimulationInProgress
            ? (playbackTimestamp || firstWindowFrame.rfc460Timestamp)
            : effectiveLastWindowTimestamp
        const currentPlaybackTimestampMs = Date.parse(graphCutoffTimestamp)
        if (!Number.isFinite(currentPlaybackTimestampMs)) return sourceFrames

        const visibleFrames = sourceFrames.filter((frame) => {
            const frameTimestampMs = Date.parse(frame.rfc460Timestamp)
            if (!Number.isFinite(frameTimestampMs)) return false
            return frameTimestampMs <= currentPlaybackTimestampMs
        })

        if (visibleFrames.length > 0) return visibleFrames
        return [sourceFrames[0]]
    }, [windowFrameTimeline, firstWindowFrame, lastWindowFrame, effectiveLastWindowTimestamp, isSimulationInProgress, playbackTimestamp])
    const goldLeadGraphData = useMemo(() => (
        buildGoldLeadGraphData(
            goldLeadTimelineFrames,
            firstWindowFrame.rfc460Timestamp,
            inferredHeraldKillCounts,
            inferredHeraldKillTimestampByTeam,
            goldGraphDimensions,
        )
    ), [goldLeadTimelineFrames, firstWindowFrame.rfc460Timestamp, inferredHeraldKillCounts, inferredHeraldKillTimestampByTeam, goldGraphDimensions])
    const backfillStatusClassName = backfillStatus === `running` ? `running` : backfillStatus === `completed` ? `completed` : `idle`
    const backfillStatusLabel = backfillStatus === `running`
        ? `Backfill in progress: syncing historical items...`
        : backfillStatus === `completed`
            ? `Backfill completed: historical items synced.`
            : `Backfill pending: waiting for timeline sync trigger.`
    const parsedCurrentFrameTimestampMs = Date.parse(effectiveLastWindowTimestamp)
    const currentFrameTimestampMs = parsedCurrentFrameTimestampMs
    const currentFrameTimestamp = Number.isFinite(currentFrameTimestampMs)
        ? new Date(currentFrameTimestampMs).toISOString()
        : effectiveLastWindowTimestamp
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
    const blueDragonIconRenderItems = getDragonIconRenderItems(lastWindowFrame.blueTeam.dragons)
    const redDragonIconRenderItems = getDragonIconRenderItems(lastWindowFrame.redTeam.dragons, true)
    const hasBlueBaronPowerPlay = displayBlueBaronPowerPlay !== null
    const hasRedBaronPowerPlay = displayRedBaronPowerPlay !== null
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
        const objectiveBuffState = hasDeathTimer ? undefined : getDisplayObjectiveBuffState(player.participantId, objectiveBuffsByParticipantId)
        const objectiveBuffClassName = getObjectiveBuffClassName(objectiveBuffState)
        return {
            side: `blue` as const,
            player,
            championDetails,
            metadata,
            hasDeathTimer,
            deathTimerSeconds,
            objectiveBuffState,
            objectiveBuffClassName,
            levelFlashClassName: shouldShowLevelFlash(player.participantId, levelFlashByParticipantId) ? `player-champion-info-level-flash` : ``,
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
        const objectiveBuffState = hasDeathTimer ? undefined : getDisplayObjectiveBuffState(player.participantId, objectiveBuffsByParticipantId)
        const objectiveBuffClassName = getObjectiveBuffClassName(objectiveBuffState)
        return {
            side: `red` as const,
            player,
            championDetails,
            metadata,
            hasDeathTimer,
            deathTimerSeconds,
            objectiveBuffState,
            objectiveBuffClassName,
            levelFlashClassName: shouldShowLevelFlash(player.participantId, levelFlashByParticipantId) ? `player-champion-info-level-flash` : ``,
            killFlashClassName: kdaFlashByCell[`k_${player.participantId}`] ? `player-stats-kda-flash-kill` : ``,
            deathFlashClassName: kdaFlashByCell[`d_${player.participantId}`] ? `player-stats-kda-flash-death` : ``,
            assistFlashClassName: kdaFlashByCell[`a_${player.participantId}`] ? `player-stats-kda-flash-assist` : ``,
        }
    })

    const isMirrorScoreboardLayout = isMirrorScoreboardLayoutMode(scoreboardLayoutMode)
    const isBasicCompactScoreboardLayout = isBasicCompactScoreboardLayoutMode(scoreboardLayoutMode)
    const scoreboardLayoutModeClassName = getScoreboardLayoutModeClassName(scoreboardLayoutMode)
    const shouldDisplayWinnerOutcome = !isSimulationInProgress || (Boolean(playbackTimestamp) && lastWindowFrame.gameState === `finished`)
    const blueTeamIsWinner = shouldDisplayWinnerOutcome && outcome?.[0]?.outcome === `win`
    const redTeamIsWinner = shouldDisplayWinnerOutcome && outcome?.[1]?.outcome === `win`

    return (
        <div className={`status-live-game-card ${scoreboardLayoutModeClassName}`}>
            <GameDetails eventDetails={eventDetails} gameIndex={gameIndex} currentWindowFrame={lastWindowFrame} />
            <div className="status-live-game-card-content">
                {/* {eventDetails ? (<h3>{eventDetails?.league.name}</h3>) : null} */}
                <div className="live-game-stats-header">
                    <div className="live-game-stats-header-team-images">
                        <div className={`live-game-card-team ${blueTeamIsWinner ? `live-game-card-team-winner` : ``}`}>
                            {blueTeam.code === "TBD" ? (<TeamTBDSVG className="live-game-card-team-image" />) : (<img className="live-game-card-team-image" src={blueTeam.image} alt={blueTeam.name} />)}
                            <span>
                                <h4>
                                    {blueTeam.name}
                                </h4>
                            </span>
                            <span className='outcome'>
                                {shouldDisplayWinnerOutcome && outcome ? (<p className={outcome[0].outcome}>
                                    {outcome[0].outcome}
                                </p>) : null}
                            </span>
                        </div>
                        <h1>
                            <div className={`gamestate-bg-${gameState.split(` `).join(`-`)}`}>{getLiveGameStateLabel(gameState)}</div>
                            <div>{inGameTime}</div>
                            <div className="live-game-kill-score">
                                <span className="blue-team-kills">{blueTeamKillDisplayValue}</span>
                                <KillSVG className="live-game-kill-score-icon" />
                                <span className="red-team-kills">{redTeamKillDisplayValue}</span>
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
                        <div className={`live-game-card-team ${redTeamIsWinner ? `live-game-card-team-winner` : ``}`}>
                            {redTeam.code === "TBD" ? (<TeamTBDSVG className="live-game-card-team-image" />) : (<img className="live-game-card-team-image" src={redTeam.image} alt={redTeam.name} />)}
                            <span>
                                <h4>
                                    {redTeam.name}
                                </h4>
                            </span>
                            <span className='outcome'>
                                {shouldDisplayWinnerOutcome && outcome ? (<p className={outcome[1].outcome}>
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
                                <span
                                    className={`team-gold-power-play-block team-gold-power-play-block-near-blue ${blueBaronPowerPlayClassName} ${hasBlueBaronPowerPlay ? `` : `team-gold-power-play-block-placeholder`}`}
                                    aria-hidden={!hasBlueBaronPowerPlay}
                                >
                                        <span className="team-gold-power-play-remaining">
                                            {hasBlueBaronPowerPlay ? formattedBlueBaronPowerPlayRemaining : `0:00`}
                                        </span>
                                        <span className={`team-gold-power-play ${blueBaronPowerPlayClassName}`}>
                                            <BaronSVG className="team-gold-power-play-icon" />
                                            <span className="team-gold-power-play-value">
                                                {hasBlueBaronPowerPlay ? formattedBlueBaronPowerPlay : `+0,000`}
                                            </span>
                                        </span>
                                </span>
                                <span className={`team-gold-value team-gold-value-blue ${goldLead > 0 ? `gold-advantage-blue` : ``}`}>{formattedBlueTeamGold}</span>
                            </span>
                            <button
                                type="button"
                                className={`gold-lead-indicator gold-lead-toggle ${goldLeadColorClass} ${isGoldGraphVisible ? `gold-lead-toggle-active` : ``}`}
                                onClick={() => setIsGoldGraphVisible((previousState) => !previousState)}
                                aria-pressed={isGoldGraphVisible}
                                aria-label={isGoldGraphVisible ? `Hide gold graph` : `Show gold graph`}
                            >
                                {goldLeadSymbol ? (
                                    <span className={`gold-lead-symbol ${goldLeadSymbolAlignmentClass} ${goldLeadColorClass}`}>{goldLeadSymbol}</span>
                                ) : null}
                                <span className={`gold-lead-value ${goldLeadColorClass}`}>{formattedGoldLead}</span>
                            </button>
                            <span className="team-gold-side-group team-gold-side-group-red">
                                <span className={`team-gold-value team-gold-value-red ${goldLead < 0 ? `gold-advantage-red` : ``}`}>{formattedRedTeamGold}</span>
                                <span
                                    className={`team-gold-power-play-block team-gold-power-play-block-near-red ${redBaronPowerPlayClassName} ${hasRedBaronPowerPlay ? `` : `team-gold-power-play-block-placeholder`}`}
                                    aria-hidden={!hasRedBaronPowerPlay}
                                >
                                        <span className="team-gold-power-play-remaining">
                                            {hasRedBaronPowerPlay ? formattedRedBaronPowerPlayRemaining : `0:00`}
                                        </span>
                                        <span className={`team-gold-power-play ${redBaronPowerPlayClassName}`}>
                                            <BaronSVG className="team-gold-power-play-icon" />
                                            <span className="team-gold-power-play-value">
                                                {hasRedBaronPowerPlay ? formattedRedBaronPowerPlay : `+0,000`}
                                            </span>
                                        </span>
                                </span>
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
                            {blueDragonIconRenderItems.map((dragonRenderItem, index) => (
                                getDragonOrSoulIcon(dragonRenderItem, 'blue', index)
                            ))}
                        </div>
                        <div className="red-team">

                            {redDragonIconRenderItems.map((dragonRenderItem, index) => (
                                getDragonOrSoulIcon(dragonRenderItem, 'red', index)
                            ))}
                        </div>
                    </div>
                    {isGoldGraphVisible ? (
                        <div className="gold-difference-graph" role="img" aria-label="Gold graph">
                            {goldLeadGraphData.points.length > 1 ? (
                                <svg
                                    className="gold-difference-graph-svg"
                                    viewBox={`0 0 ${goldGraphDimensions.width} ${goldGraphDimensions.height}`}
                                    preserveAspectRatio="none"
                                >
                                    <defs>
                                        <linearGradient id={`gold-diff-blue-fill-${gameIndex}`} x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor="rgba(74, 169, 255, 0.38)" />
                                            <stop offset="100%" stopColor="rgba(74, 169, 255, 0.08)" />
                                        </linearGradient>
                                        <linearGradient id={`gold-diff-red-fill-${gameIndex}`} x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor="rgba(255, 108, 108, 0.08)" />
                                            <stop offset="100%" stopColor="rgba(255, 108, 108, 0.36)" />
                                        </linearGradient>
                                        <clipPath id={`gold-diff-line-blue-clip-${gameIndex}`}>
                                            <rect
                                                x={goldGraphDimensions.paddingLeft}
                                                y={goldGraphDimensions.paddingTop}
                                                width={goldGraphDimensions.width - goldGraphDimensions.paddingLeft - goldGraphDimensions.paddingRight}
                                                height={Math.max(0, goldLeadGraphData.zeroY - goldGraphDimensions.paddingTop)}
                                            />
                                        </clipPath>
                                        <clipPath id={`gold-diff-line-red-clip-${gameIndex}`}>
                                            <rect
                                                x={goldGraphDimensions.paddingLeft}
                                                y={goldLeadGraphData.zeroY}
                                                width={goldGraphDimensions.width - goldGraphDimensions.paddingLeft - goldGraphDimensions.paddingRight}
                                                height={Math.max(0, (goldGraphDimensions.height - goldGraphDimensions.paddingBottom) - goldLeadGraphData.zeroY)}
                                            />
                                        </clipPath>
                                    </defs>
                                    <rect className="gold-difference-graph-background" x="0" y="0" width={goldGraphDimensions.width} height={goldGraphDimensions.height} />
                                    {goldLeadGraphData.ticks.map((tick) => (
                                        <g key={`gold_graph_tick_${tick.label}_${tick.seconds}`}>
                                            <line
                                                className="gold-difference-graph-grid-line"
                                                x1={tick.x}
                                                y1={goldGraphDimensions.paddingTop}
                                                x2={tick.x}
                                                y2={goldGraphDimensions.height - goldGraphDimensions.paddingBottom}
                                            />
                                            <text className="gold-difference-graph-tick-label" x={tick.x} y={goldGraphDimensions.height - 18} textAnchor="middle">
                                                {tick.label}
                                            </text>
                                        </g>
                                    ))}
                                    <line
                                        className="gold-difference-graph-zero-line"
                                        x1={goldGraphDimensions.paddingLeft}
                                        y1={goldLeadGraphData.zeroY}
                                        x2={goldGraphDimensions.width - goldGraphDimensions.paddingRight}
                                        y2={goldLeadGraphData.zeroY}
                                    />
                                    <text className="gold-difference-graph-y-label" x={10} y={goldGraphDimensions.paddingTop + 4}>
                                        {goldLeadGraphData.topLabel}
                                    </text>
                                    <text className="gold-difference-graph-y-label" x={12} y={goldLeadGraphData.zeroY + 4}>
                                        0
                                    </text>
                                    <text className="gold-difference-graph-y-label" x={10} y={goldGraphDimensions.height - goldGraphDimensions.paddingBottom + 4}>
                                        {goldLeadGraphData.bottomLabel}
                                    </text>
                                    <path
                                        className="gold-difference-graph-area-blue"
                                        d={goldLeadGraphData.positiveAreaPath}
                                        fill={`url(#gold-diff-blue-fill-${gameIndex})`}
                                    />
                                    <path
                                        className="gold-difference-graph-area-red"
                                        d={goldLeadGraphData.negativeAreaPath}
                                        fill={`url(#gold-diff-red-fill-${gameIndex})`}
                                    />
                                    <path
                                        className="gold-difference-graph-line gold-difference-graph-line-blue"
                                        d={goldLeadGraphData.linePath}
                                        clipPath={`url(#gold-diff-line-blue-clip-${gameIndex})`}
                                    />
                                    <path
                                        className="gold-difference-graph-line gold-difference-graph-line-red"
                                        d={goldLeadGraphData.linePath}
                                        clipPath={`url(#gold-diff-line-red-clip-${gameIndex})`}
                                    />
                                    {goldLeadGraphData.points.map((point) => (
                                        <circle
                                            key={`gold_graph_point_${point.elapsedSeconds}_${point.lead}_${point.x}`}
                                            className={point.lead >= 0 ? `gold-difference-graph-point-blue` : `gold-difference-graph-point-red`}
                                            cx={point.x}
                                            cy={point.y}
                                            r={1.25}
                                        />
                                    ))}
                                    {goldLeadGraphData.eventMarkers.map((eventMarker, eventMarkerIndex) => (
                                        <g key={`gold_graph_event_${eventMarker.type}_${eventMarker.team}_${eventMarker.elapsedSeconds}_${eventMarkerIndex}`}>
                                            {eventMarker.type === `dragon` ? (
                                                <DragonObjectiveSVG
                                                    className={`gold-difference-graph-event-icon gold-difference-graph-event-icon-${eventMarker.team}`}
                                                    x={eventMarker.x - (goldGraphDimensions.eventMarkerSize / 2)}
                                                    y={goldGraphDimensions.eventMarkerY - (goldGraphDimensions.eventMarkerSize / 2)}
                                                    width={goldGraphDimensions.eventMarkerSize}
                                                    height={goldGraphDimensions.eventMarkerSize}
                                                />
                                            ) : null}
                                            {eventMarker.type === `baron` ? (
                                                <BaronSVG
                                                    className={`gold-difference-graph-event-icon gold-difference-graph-event-icon-${eventMarker.team}`}
                                                    x={eventMarker.x - (goldGraphDimensions.eventMarkerSize / 2)}
                                                    y={goldGraphDimensions.eventMarkerY - (goldGraphDimensions.eventMarkerSize / 2)}
                                                    width={goldGraphDimensions.eventMarkerSize}
                                                    height={goldGraphDimensions.eventMarkerSize}
                                                />
                                            ) : null}
                                            {eventMarker.type === `tower` ? (
                                                <TowerSVG
                                                    className={`gold-difference-graph-event-icon gold-difference-graph-event-icon-${eventMarker.team}`}
                                                    x={eventMarker.x - (goldGraphDimensions.eventMarkerSize / 2)}
                                                    y={goldGraphDimensions.eventMarkerY - (goldGraphDimensions.eventMarkerSize / 2)}
                                                    width={goldGraphDimensions.eventMarkerSize}
                                                    height={goldGraphDimensions.eventMarkerSize}
                                                />
                                            ) : null}
                                            {eventMarker.type === `herald` ? (
                                                <image
                                                    href={HeraldIcon}
                                                    className={`gold-difference-graph-event-icon-image gold-difference-graph-event-icon-image-${eventMarker.team}`}
                                                    x={eventMarker.x - (goldGraphDimensions.eventMarkerSize / 2)}
                                                    y={goldGraphDimensions.eventMarkerY - (goldGraphDimensions.eventMarkerSize / 2)}
                                                    width={goldGraphDimensions.eventMarkerSize}
                                                    height={goldGraphDimensions.eventMarkerSize}
                                                />
                                            ) : null}
                                            {eventMarker.count > 1 ? (
                                                <text
                                                    className={`gold-difference-graph-event-count gold-difference-graph-event-count-${eventMarker.team}`}
                                                    x={eventMarker.x + 5.2}
                                                    y={goldGraphDimensions.eventMarkerY - 4.8}
                                                >
                                                    {eventMarker.count}
                                                </text>
                                            ) : null}
                                        </g>
                                    ))}
                                </svg>
                            ) : (
                                <div className="gold-difference-graph-empty">
                                    Collecting graph data...
                                </div>
                            )}
                        </div>
                    ) : null}
                </div>
                {!isMirrorScoreboardLayout ? (
                isBasicCompactScoreboardLayout ? (
                <div className="status-live-game-card-table-wrapper status-live-game-card-table-wrapper-basic-compact">
                    <table className="status-live-game-card-table status-live-game-card-table-basic-compact">
                        <thead>
                            <tr key={`${blueTeam.code.toUpperCase()}_basic_compact`}>
                                <th className="table-top-row-champion" title="champion" aria-label="champion" />
                                <th className="basic-compact-cs-header-cell" title="creep score" aria-label="creep score" />
                                <th className="basic-compact-stats-header-cell" title="stats">
                                    <div className="basic-compact-stats-header-top">
                                        <span>K</span>
                                        <span>D</span>
                                        <span>A</span>
                                        <span>GOLD</span>
                                    </div>
                                    <div className="basic-compact-stats-header-bottom">
                                        <span>ITEMS</span>
                                    </div>
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {blueRows.map((row) => {
                                const goldDifference = getGoldDifference(row.player, lastWindowFrame)
                                const hasCsLead = hasCsLeadAgainstLaneOpponent(row.player, lastWindowFrame)
                                return [(
                                    <tr className="player-stats-row basic-compact-player-row" key={`basic_blue_${gameIndex}_${row.player.participantId}`}>
                                        <th className="basic-compact-name-cell">
                                            <div className="basic-compact-name-stack">
                                                <div className={`player-champion-info ${row.hasDeathTimer ? `player-champion-info-dead` : ``} ${row.objectiveBuffClassName} ${row.levelFlashClassName ? `player-champion-info-level-flashing` : ``}`}>
                                                    {renderObjectiveBuffBackdropIcons(row.objectiveBuffState)}
                                                    {getParticipantRuneTypes(row.championDetails, runes)}
                                                    <div className={`player-champion-wrapper ${row.hasDeathTimer ? `dead` : ``}`}>
                                                        {row.hasDeathTimer ? <span className="player-death-timer">{row.deathTimerSeconds}</span> : null}
                                                        <img
                                                            src={`${championsUrlWithPatchVersion}${row.metadata.championId}.png`}
                                                            alt=""
                                                            className='player-champion'
                                                            onError={({ currentTarget }) => { currentTarget.style.display = `none` }}
                                                        />
                                                        <TeamTBDSVG className='player-champion' />
                                                        <span className={` player-champion-info-level ${row.levelFlashClassName}`}>{row.player.level}</span>
                                                    </div>
                                                    <div className=" player-champion-info-name">
                                                        <span>{row.metadata.summonerName}</span>
                                                        <span className=" player-card-player-name">{getChampionDisplayName(row.metadata.championId)}</span>
                                                    </div>
                                                </div>
                                                <div className="basic-compact-name-health">
                                                    <MiniHealthBar currentHealth={row.player.currentHealth} maxHealth={row.player.maxHealth} />
                                                </div>
                                            </div>
                                        </th>
                                        <td className={`basic-compact-cs-cell ${hasCsLead ? `player-cs-lead-cell` : ``}`}>
                                            <div className="basic-compact-cs-stack">
                                                <div className="basic-compact-cs-label">CS</div>
                                                <div className="player-stats player-stats-cs basic-compact-cs-value">{row.player.creepScore}</div>
                                            </div>
                                        </td>
                                        <td className="basic-compact-summary-cell">
                                            <div className="basic-compact-summary-top">
                                                <div className={`player-stats player-stats-kda basic-compact-stat ${row.killFlashClassName}`}>{row.player.kills}</div>
                                                <div className={`player-stats player-stats-kda basic-compact-stat ${row.deathFlashClassName}`}>{row.player.deaths}</div>
                                                <div className={`player-stats player-stats-kda basic-compact-stat ${row.assistFlashClassName}`}>{row.player.assists}</div>
                                                <div className="player-stats player-stats-gold basic-compact-stat basic-compact-stat-gold">
                                                    <span>{Number(row.player.totalGold).toLocaleString(`en-us`)}</span>
                                                    <span className={`player-stats-gold-diff ${goldDifference > 0 ? `player-gold-positive` : goldDifference < 0 ? `player-gold-negative` : ``}`}>
                                                        {getFormattedGoldDifference(goldDifference)}
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="basic-compact-summary-bottom">
                                                <div className="basic-compact-summary-items">
                                                    <ItemsDisplay
                                                        participantId={row.player.participantId - 1}
                                                        lastFrame={lastDetailsFrame}
                                                        items={items}
                                                        patchVersion={formattedPatchVersion}
                                                        role={row.metadata.role}
                                                        highlightedItemIds={highlightedPurchasedItemsByParticipantId[row.player.participantId]}
                                                        forcePreviewHighlight={FORCE_ITEM_PURCHASE_HIGHLIGHT_PREVIEW}
                                                    />
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                ), (
                                    <tr key={`basic_blue_stats_${gameIndex}_${row.player.participantId}`} className='champion-stats-row'>
                                        <td colSpan={3}>
                                            <span>
                                                {getFormattedChampionStats(
                                                    row.championDetails,
                                                    runes,
                                                    selectedRuneKeyByParticipantId[row.championDetails.participantId],
                                                    (runeKey) => setSelectedRuneKeyByParticipantId((previousState) => ({
                                                        ...previousState,
                                                        [row.championDetails.participantId]: runeKey,
                                                    })),
                                                )}
                                            </span>
                                        </td>
                                    </tr>
                                )]
                            })}
                        </tbody>
                    </table>

                    <table className="status-live-game-card-table status-live-game-card-table-basic-compact">
                        <thead>
                            <tr key={`${redTeam.code.toUpperCase()}_basic_compact`}>
                                <th className="table-top-row-champion" title="champion" aria-label="champion" />
                                <th className="basic-compact-cs-header-cell" title="creep score" aria-label="creep score" />
                                <th className="basic-compact-stats-header-cell" title="stats">
                                    <div className="basic-compact-stats-header-top">
                                        <span>K</span>
                                        <span>D</span>
                                        <span>A</span>
                                        <span>GOLD</span>
                                    </div>
                                    <div className="basic-compact-stats-header-bottom">
                                        <span>ITEMS</span>
                                    </div>
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {redRows.map((row) => {
                                const goldDifference = getGoldDifference(row.player, lastWindowFrame)
                                const hasCsLead = hasCsLeadAgainstLaneOpponent(row.player, lastWindowFrame)
                                return [(
                                    <tr className="player-stats-row basic-compact-player-row" key={`basic_red_${gameIndex}_${row.player.participantId}`}>
                                        <th className="basic-compact-name-cell">
                                            <div className="basic-compact-name-stack">
                                                <div className={`player-champion-info ${row.hasDeathTimer ? `player-champion-info-dead` : ``} ${row.objectiveBuffClassName} ${row.levelFlashClassName ? `player-champion-info-level-flashing` : ``}`}>
                                                    {renderObjectiveBuffBackdropIcons(row.objectiveBuffState)}
                                                    {getParticipantRuneTypes(row.championDetails, runes)}
                                                    <div className={`player-champion-wrapper ${row.hasDeathTimer ? `dead` : ``}`}>
                                                        {row.hasDeathTimer ? <span className="player-death-timer">{row.deathTimerSeconds}</span> : null}
                                                        <img
                                                            src={`${championsUrlWithPatchVersion}${row.metadata.championId}.png`}
                                                            alt=""
                                                            className='player-champion'
                                                            onError={({ currentTarget }) => { currentTarget.style.display = `none` }}
                                                        />
                                                        <TeamTBDSVG className='player-champion' />
                                                        <span className={` player-champion-info-level ${row.levelFlashClassName}`}>{row.player.level}</span>
                                                    </div>
                                                    <div className=" player-champion-info-name">
                                                        <span>{row.metadata.summonerName}</span>
                                                        <span className=" player-card-player-name">{getChampionDisplayName(row.metadata.championId)}</span>
                                                    </div>
                                                </div>
                                                <div className="basic-compact-name-health">
                                                    <MiniHealthBar currentHealth={row.player.currentHealth} maxHealth={row.player.maxHealth} />
                                                </div>
                                            </div>
                                        </th>
                                        <td className={`basic-compact-cs-cell ${hasCsLead ? `player-cs-lead-cell` : ``}`}>
                                            <div className="basic-compact-cs-stack">
                                                <div className="basic-compact-cs-label">CS</div>
                                                <div className="player-stats player-stats-cs basic-compact-cs-value">{row.player.creepScore}</div>
                                            </div>
                                        </td>
                                        <td className="basic-compact-summary-cell">
                                            <div className="basic-compact-summary-top">
                                                <div className={`player-stats player-stats-kda basic-compact-stat ${row.killFlashClassName}`}>{row.player.kills}</div>
                                                <div className={`player-stats player-stats-kda basic-compact-stat ${row.deathFlashClassName}`}>{row.player.deaths}</div>
                                                <div className={`player-stats player-stats-kda basic-compact-stat ${row.assistFlashClassName}`}>{row.player.assists}</div>
                                                <div className="player-stats player-stats-gold basic-compact-stat basic-compact-stat-gold">
                                                    <span>{Number(row.player.totalGold).toLocaleString(`en-us`)}</span>
                                                    <span className={`player-stats-gold-diff ${goldDifference > 0 ? `player-gold-positive` : goldDifference < 0 ? `player-gold-negative` : ``}`}>
                                                        {getFormattedGoldDifference(goldDifference)}
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="basic-compact-summary-bottom">
                                                <div className="basic-compact-summary-items">
                                                    <ItemsDisplay
                                                        participantId={row.player.participantId - 1}
                                                        lastFrame={lastDetailsFrame}
                                                        items={items}
                                                        patchVersion={formattedPatchVersion}
                                                        role={row.metadata.role}
                                                        highlightedItemIds={highlightedPurchasedItemsByParticipantId[row.player.participantId]}
                                                        forcePreviewHighlight={FORCE_ITEM_PURCHASE_HIGHLIGHT_PREVIEW}
                                                    />
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                ), (
                                    <tr key={`basic_red_stats_${gameIndex}_${row.player.participantId}`} className='champion-stats-row'>
                                        <td colSpan={3}>
                                            <span>
                                                {getFormattedChampionStats(
                                                    row.championDetails,
                                                    runes,
                                                    selectedRuneKeyByParticipantId[row.championDetails.participantId],
                                                    (runeKey) => setSelectedRuneKeyByParticipantId((previousState) => ({
                                                        ...previousState,
                                                        [row.championDetails.participantId]: runeKey,
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
                                const hasCsLead = hasCsLeadAgainstLaneOpponent(player, lastWindowFrame)
                                let championDetails = lastDetailsFrame.participants[index]
                                const killFlashClassName = kdaFlashByCell[`k_${player.participantId}`] ? `player-stats-kda-flash-kill` : ``
                                const deathFlashClassName = kdaFlashByCell[`d_${player.participantId}`] ? `player-stats-kda-flash-death` : ``
                                const assistFlashClassName = kdaFlashByCell[`a_${player.participantId}`] ? `player-stats-kda-flash-assist` : ``
                                const deathTimerSeconds = deathTimerSecondsByParticipantId[player.participantId]
                                const hasDeathTimer = Number.isFinite(deathTimerSeconds) && Number(deathTimerSeconds) > 0
                                const objectiveBuffState = hasDeathTimer ? undefined : getDisplayObjectiveBuffState(player.participantId, objectiveBuffsByParticipantId)
                                const objectiveBuffClassName = getObjectiveBuffClassName(objectiveBuffState)
                                const levelFlashClassName = shouldShowLevelFlash(player.participantId, levelFlashByParticipantId) ? `player-champion-info-level-flash` : ``
                                return [(
                                    <tr className="player-stats-row" key={`${gameIndex}_${championsUrlWithPatchVersion}${gameMetadata.blueTeamMetadata.participantMetadata[player.participantId - 1].championId}`}>
                                        <th>
                                            <div className={`player-champion-info ${hasDeathTimer ? `player-champion-info-dead` : ``} ${objectiveBuffClassName} ${levelFlashClassName ? `player-champion-info-level-flashing` : ``}`}>
                                                {renderObjectiveBuffBackdropIcons(objectiveBuffState)}
                                                {getParticipantRuneTypes(championDetails, runes)}
                                                <div className={`player-champion-wrapper ${hasDeathTimer ? `dead` : ``}`}>
                                                    {hasDeathTimer ? <span className="player-death-timer">{deathTimerSeconds}</span> : null}
                                                    <img src={`${championsUrlWithPatchVersion}${gameMetadata.blueTeamMetadata.participantMetadata[player.participantId - 1].championId}.png`} alt="" className='player-champion' onError={({ currentTarget }) => { currentTarget.style.display = `none` }} />
                                                    <TeamTBDSVG className='player-champion' />
                                                    <span className={` player-champion-info-level ${levelFlashClassName}`}>{player.level}</span>
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
                                                highlightedItemIds={highlightedPurchasedItemsByParticipantId[player.participantId]}
                                                forcePreviewHighlight={FORCE_ITEM_PURCHASE_HIGHLIGHT_PREVIEW}
                                            />
                                        </td>
                                        <td className={hasCsLead ? `player-cs-lead-cell` : ``}>
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
                                const hasCsLead = hasCsLeadAgainstLaneOpponent(player, lastWindowFrame)
                                let championDetails = lastDetailsFrame.participants[index + 5]
                                const killFlashClassName = kdaFlashByCell[`k_${player.participantId}`] ? `player-stats-kda-flash-kill` : ``
                                const deathFlashClassName = kdaFlashByCell[`d_${player.participantId}`] ? `player-stats-kda-flash-death` : ``
                                const assistFlashClassName = kdaFlashByCell[`a_${player.participantId}`] ? `player-stats-kda-flash-assist` : ``
                                const deathTimerSeconds = deathTimerSecondsByParticipantId[player.participantId]
                                const hasDeathTimer = Number.isFinite(deathTimerSeconds) && Number(deathTimerSeconds) > 0
                                const objectiveBuffState = hasDeathTimer ? undefined : getDisplayObjectiveBuffState(player.participantId, objectiveBuffsByParticipantId)
                                const objectiveBuffClassName = getObjectiveBuffClassName(objectiveBuffState)
                                const levelFlashClassName = shouldShowLevelFlash(player.participantId, levelFlashByParticipantId) ? `player-champion-info-level-flash` : ``

                                return [(
                                    <tr className="player-stats-row" key={`${gameIndex}_${championsUrlWithPatchVersion}${gameMetadata.redTeamMetadata.participantMetadata[player.participantId - 6].championId}`}>
                                        <th>
                                            <div className={`player-champion-info ${hasDeathTimer ? `player-champion-info-dead` : ``} ${objectiveBuffClassName} ${levelFlashClassName ? `player-champion-info-level-flashing` : ``}`}>
                                                {renderObjectiveBuffBackdropIcons(objectiveBuffState)}
                                                {getParticipantRuneTypes(championDetails, runes)}
                                                <div className={`player-champion-wrapper ${hasDeathTimer ? `dead` : ``}`}>
                                                    {hasDeathTimer ? <span className="player-death-timer">{deathTimerSeconds}</span> : null}
                                                    <img src={`${championsUrlWithPatchVersion}${gameMetadata.redTeamMetadata.participantMetadata[player.participantId - 6].championId}.png`} alt="" className='player-champion' onError={({ currentTarget }) => { currentTarget.style.display = `none` }} />
                                                    <TeamTBDSVG className='player-champion' />
                                                    <span className={` player-champion-info-level ${levelFlashClassName}`}>{player.level}</span>
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
                                                highlightedItemIds={highlightedPurchasedItemsByParticipantId[player.participantId]}
                                                forcePreviewHighlight={FORCE_ITEM_PURCHASE_HIGHLIGHT_PREVIEW}
                                            />
                                        </td>
                                        <td className={hasCsLead ? `player-cs-lead-cell` : ``}>
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
                )
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
                                                    highlightedItemIds={highlightedPurchasedItemsByParticipantId[blueRow.player.participantId]}
                                                    forcePreviewHighlight={FORCE_ITEM_PURCHASE_HIGHLIGHT_PREVIEW}
                                                />
                                            </td>
                                            <td>
                                                <MiniHealthBar currentHealth={blueRow.player.currentHealth} maxHealth={blueRow.player.maxHealth} />
                                            </td>
                                            <th className="mirror-player-cell mirror-player-cell-left">
                                                <button type="button" className="mirror-player-toggle" onClick={() => toggleMirrorParticipantStats(blueRow.player.participantId, redRow.player.participantId)}>
                                                    <div className={`player-champion-info mirror-player-champion-info-left ${blueRow.hasDeathTimer ? `player-champion-info-dead` : ``} ${blueRow.objectiveBuffClassName} ${blueRow.levelFlashClassName ? `player-champion-info-level-flashing` : ``}`}>
                                                        {renderObjectiveBuffBackdropIcons(blueRow.objectiveBuffState)}
                                                        <div className=" player-champion-info-name mirror-player-name-left">
                                                            <span>{blueRow.metadata.summonerName}</span>
                                                            <span className=" player-card-player-name">{getChampionDisplayName(blueRow.metadata.championId)}</span>
                                                        </div>
                                                        <div className={`player-champion-wrapper ${blueRow.hasDeathTimer ? `dead` : ``}`}>
                                                            {blueRow.hasDeathTimer ? <span className="player-death-timer">{blueRow.deathTimerSeconds}</span> : null}
                                                            <img src={`${championsUrlWithPatchVersion}${blueRow.metadata.championId}.png`} alt="" className='player-champion' onError={({ currentTarget }) => { currentTarget.style.display = `none` }} />
                                                            <TeamTBDSVG className='player-champion' />
                                                            <span className={` player-champion-info-level ${blueRow.levelFlashClassName}`}>{blueRow.player.level}</span>
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
                                                    <div className={`player-champion-info mirror-player-champion-info-right ${redRow.hasDeathTimer ? `player-champion-info-dead` : ``} ${redRow.objectiveBuffClassName} ${redRow.levelFlashClassName ? `player-champion-info-level-flashing` : ``}`}>
                                                        {renderObjectiveBuffBackdropIcons(redRow.objectiveBuffState)}
                                                        {getParticipantRuneTypes(redRow.championDetails, runes)}
                                                        <div className={`player-champion-wrapper ${redRow.hasDeathTimer ? `dead` : ``}`}>
                                                            {redRow.hasDeathTimer ? <span className="player-death-timer">{redRow.deathTimerSeconds}</span> : null}
                                                            <img src={`${championsUrlWithPatchVersion}${redRow.metadata.championId}.png`} alt="" className='player-champion' onError={({ currentTarget }) => { currentTarget.style.display = `none` }} />
                                                            <TeamTBDSVG className='player-champion' />
                                                            <span className={` player-champion-info-level ${redRow.levelFlashClassName}`}>{redRow.player.level}</span>
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
                                                    highlightedItemIds={highlightedPurchasedItemsByParticipantId[redRow.player.participantId]}
                                                    forcePreviewHighlight={FORCE_ITEM_PURCHASE_HIGHLIGHT_PREVIEW}
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
                <select
                    className="footer-notes scoreboard-layout-select"
                    value={scoreboardLayoutMode}
                    onChange={(event) => setScoreboardLayoutMode(parseScoreboardLayoutMode(event.target.value))}
                    aria-label="Scoreboard layout"
                >
                    {SCOREBOARD_LAYOUT_MODE_OPTIONS.map((layoutMode) => (
                        <option key={layoutMode} value={layoutMode}>
                            {SCOREBOARD_LAYOUT_MODE_LABELS[layoutMode]}
                        </option>
                    ))}
                </select>
                <span className="footer-notes">
                    <button
                        type="button"
                        className="copy-champion-names"
                        onClick={() => onDebugSimulationModeChange?.(!debugSimulationModeEnabled)}
                        aria-pressed={debugSimulationModeEnabled}
                    >
                        {debugSimulationModeEnabled ? `디버그 모드 ON` : `디버그 모드 OFF`}
                    </button>
                </span>
                {debugSimulationModeEnabled ? (
                    <span className="footer-notes">
                        <button
                            type="button"
                            className="copy-champion-names"
                            onClick={() => onDebugSimulationToggle?.()}
                        >
                            {debugSimulationRunning ? `경기 시뮬레이션 중지` : `경기 시뮬레이션`}
                        </button>
                    </span>
                ) : null}
                {debugSimulationModeEnabled && debugSimulationRunning && debugSimulationJumpMinutes.length > 0
                    ? debugSimulationJumpMinutes.map((targetMinute) => (
                        <span className="footer-notes" key={`debug_sim_jump_${targetMinute}`}>
                            <button
                                type="button"
                                className="copy-champion-names"
                                onClick={() => onDebugSimulationJumpToMinute?.(targetMinute)}
                            >
                                {`${targetMinute}분`}
                            </button>
                        </span>
                    ))
                    : null}
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
                <LiveAPIWatcher gameIndex={gameIndex} elapsedGameTimeSeconds={elapsedGameTimeSeconds} gameMetadata={gameMetadata} lastWindowFrame={lastWindowFrame} championsUrlWithPatchVersion={championsUrlWithPatchVersion} blueTeam={eventDetails.match.teams[0]} redTeam={eventDetails.match.teams[1]} />
            </div>
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

function getAliveParticipantIdSet(participants: WindowParticipant[]) {
    return new Set<number>(
        participants
            .filter((participant) => Number(participant.currentHealth) > 0)
            .map((participant) => participant.participantId),
    )
}

function removeParticipantObjectiveBuffs(
    participantId: number,
    baronBuffParticipantIdsByTeam: ObjectiveBuffParticipantIdsByTeam,
    elderBuffParticipantIdsByTeam: ObjectiveBuffParticipantIdsByTeam,
) {
    let changed = false
    ;([`blue`, `red`] as TeamKey[]).forEach((teamKey) => {
        changed = baronBuffParticipantIdsByTeam[teamKey].delete(participantId) || changed
        changed = elderBuffParticipantIdsByTeam[teamKey].delete(participantId) || changed
    })
    return changed
}

function clearHolderlessBaronPowerPlaySnapshots(
    baronPowerPlaySnapshotByTeam: { blue: BaronPowerPlaySnapshot | null, red: BaronPowerPlaySnapshot | null },
    baronBuffParticipantIdsByTeam: ObjectiveBuffParticipantIdsByTeam,
) {
    let changed = false
    ;([`blue`, `red`] as TeamKey[]).forEach((teamKey) => {
        if (baronPowerPlaySnapshotByTeam[teamKey] && baronBuffParticipantIdsByTeam[teamKey].size === 0) {
            baronPowerPlaySnapshotByTeam[teamKey] = null
            changed = true
        }
    })
    return changed
}

function clearHolderlessElderBuffs(
    elderBuffEndAtMsByTeam: { blue: number | null, red: number | null },
    elderBuffParticipantIdsByTeam: ObjectiveBuffParticipantIdsByTeam,
) {
    let changed = false
    ;([`blue`, `red`] as TeamKey[]).forEach((teamKey) => {
        if (elderBuffEndAtMsByTeam[teamKey] && elderBuffParticipantIdsByTeam[teamKey].size === 0) {
            elderBuffEndAtMsByTeam[teamKey] = null
            changed = true
        }
    })
    return changed
}

function buildObjectiveBuffsByParticipantId(
    baronBuffParticipantIdsByTeam: ObjectiveBuffParticipantIdsByTeam,
    elderBuffParticipantIdsByTeam: ObjectiveBuffParticipantIdsByTeam,
) {
    const objectiveBuffsByParticipantId: ObjectiveBuffsByParticipantId = {}

    ;([`blue`, `red`] as TeamKey[]).forEach((teamKey) => {
        baronBuffParticipantIdsByTeam[teamKey].forEach((participantId) => {
            objectiveBuffsByParticipantId[participantId] = {
                ...(objectiveBuffsByParticipantId[participantId] || { baron: false, elder: false }),
                baron: true,
            }
        })
        elderBuffParticipantIdsByTeam[teamKey].forEach((participantId) => {
            objectiveBuffsByParticipantId[participantId] = {
                ...(objectiveBuffsByParticipantId[participantId] || { baron: false, elder: false }),
                elder: true,
            }
        })
    })

    return objectiveBuffsByParticipantId
}

function getDisplayObjectiveBuffState(
    participantId: number,
    objectiveBuffsByParticipantId: ObjectiveBuffsByParticipantId,
): ObjectiveBuffState | undefined {
    if (FORCE_OBJECTIVE_BUFF_HOLDER_PREVIEW) {
        const previewSlot = ((participantId - 1) % 5) + 1
        if (previewSlot === 1) return { baron: true, elder: false }
        if (previewSlot === 2) return { baron: false, elder: true }
        if (previewSlot === 3) return { baron: true, elder: true }
    }

    return objectiveBuffsByParticipantId[participantId]
}

function getObjectiveBuffClassName(objectiveBuffState?: ObjectiveBuffState) {
    if (!objectiveBuffState) return ``
    if (objectiveBuffState.baron && objectiveBuffState.elder) return `player-champion-info-objective-buffs`
    if (objectiveBuffState.baron) return `player-champion-info-baron-buff`
    if (objectiveBuffState.elder) return `player-champion-info-elder-buff`
    return ``
}

function shouldShowLevelFlash(
    participantId: number,
    levelFlashByParticipantId: { [participantId: number]: boolean },
) {
    if (FORCE_LEVEL_UP_HIGHLIGHT_PREVIEW) {
        const previewSlot = ((participantId - 1) % 5) + 1
        return previewSlot === 1 || previewSlot === 3 || previewSlot === 5
    }
    return Boolean(levelFlashByParticipantId[participantId])
}

function sanitizeDetailsItemIds(itemIds: number[] | undefined) {
    if (!Array.isArray(itemIds)) return []
    return itemIds.filter((itemId) => Number.isFinite(itemId) && itemId > 0)
}

function getAddedItemIdsByCount(previousItemIds: number[], currentItemIds: number[]) {
    const previousItemCountById = getItemCountById(previousItemIds)
    const addedItemIds: number[] = []

    currentItemIds.forEach((itemId) => {
        const previousCount = previousItemCountById.get(itemId) || 0
        if (previousCount > 0) {
            previousItemCountById.set(itemId, previousCount - 1)
            return
        }
        addedItemIds.push(itemId)
    })

    return addedItemIds
}

function getItemCountById(itemIds: number[]) {
    const itemCountById = new Map<number, number>()
    itemIds.forEach((itemId) => {
        itemCountById.set(itemId, (itemCountById.get(itemId) || 0) + 1)
    })
    return itemCountById
}

function getMajorPurchaseHighlightItemId(addedItemId: number, currentItemIds: number[], items: Item[]) {
    if (isMajorPurchaseHighlightItem(addedItemId, items)) return addedItemId

    const registeredTargetItemId = PURCHASE_HIGHLIGHT_TARGET_BY_SOURCE_ITEM_ID.get(addedItemId)
    if (
        registeredTargetItemId !== undefined
        && currentItemIds.includes(registeredTargetItemId)
        && isMajorPurchaseHighlightItem(registeredTargetItemId, items)
    ) {
        return registeredTargetItemId
    }

    return undefined
}

function isMajorPurchaseHighlightItem(itemId: number, items: Item[]) {
    if (isPurchaseHighlightTrinketItem(itemId, items)) return false
    if (isPurchaseHighlightConsumableItem(itemId, items)) return false

    const item = items[itemId]
    const hasUpgradeTargets = Boolean(item && Array.isArray(item.into) && item.into.length > 0)
    if (!hasUpgradeTargets) return true
    return PURCHASE_HIGHLIGHT_REGISTERED_TARGET_ITEM_IDS.has(itemId)
}

function isPurchaseHighlightTrinketItem(itemId: number, items: Item[]) {
    const item = items[itemId]
    if (item?.tags && item.tags.includes(`Trinket`)) return true
    return PURCHASE_HIGHLIGHT_TRINKET_ITEM_IDS.includes(itemId)
}

function isPurchaseHighlightConsumableItem(itemId: number, items: Item[]) {
    const item = items[itemId]
    if (item?.consumed) return true
    if (item?.tags && item.tags.includes(`Consumable`)) return true
    return PURCHASE_HIGHLIGHT_FALLBACK_CONSUMABLE_ITEM_IDS.includes(itemId)
}

function renderObjectiveBuffBackdropIcons(objectiveBuffState?: ObjectiveBuffState) {
    if (!objectiveBuffState || (!objectiveBuffState.baron && !objectiveBuffState.elder)) return null

    return (
        <span className="player-objective-buff-icons" aria-hidden="true">
            {objectiveBuffState.baron ? <BaronSVG className="player-objective-buff-icon player-objective-buff-icon-baron" /> : null}
            {objectiveBuffState.elder ? <ElderDragonSVG className="player-objective-buff-icon player-objective-buff-icon-elder" /> : null}
        </span>
    )
}

function buildGoldLeadGraphData(
    windowFrames: WindowFrame[],
    firstWindowTimestamp: string,
    inferredHeraldKillCounts: { blue: number, red: number },
    inferredHeraldKillTimestampByTeam: { blue: string | null, red: string | null },
    dimensions: GoldGraphDimensions,
): GoldLeadGraphData {
    const timelinePoints = buildGoldLeadTimelinePoints(windowFrames, firstWindowTimestamp)
    const chartTop = dimensions.paddingTop
    const chartBottom = dimensions.height - dimensions.paddingBottom
    const chartInnerHeight = chartBottom - chartTop
    const defaultZeroY = chartTop + (chartInnerHeight / 2)
    if (timelinePoints.length === 0) {
        return {
            points: [],
            ticks: [{ seconds: 0, x: dimensions.paddingLeft, label: `0` }],
            eventMarkers: [],
            linePath: ``,
            positiveAreaPath: ``,
            negativeAreaPath: ``,
            zeroY: defaultZeroY,
            topLabel: `0`,
            bottomLabel: `0`,
        }
    }

    const maxElapsedSeconds = Math.max(1, timelinePoints[timelinePoints.length - 1].elapsedSeconds)
    const maxBlueLead = Math.max(0, ...timelinePoints.map((point) => point.lead))
    const maxRedLeadAbs = Math.max(0, ...timelinePoints.map((point) => Math.abs(Math.min(point.lead, 0))))
    const totalLeadMagnitude = maxBlueLead + maxRedLeadAbs
    const rawPositiveHeightRatio = totalLeadMagnitude > 0
        ? maxBlueLead / totalLeadMagnitude
        : 0.5
    const positiveHeightRatio = Math.min(
        1 - GOLD_GRAPH_MIN_SIDE_RATIO,
        Math.max(GOLD_GRAPH_MIN_SIDE_RATIO, rawPositiveHeightRatio),
    )
    const positiveLeadHeight = chartInnerHeight * positiveHeightRatio
    const negativeLeadHeight = chartInnerHeight - positiveLeadHeight
    const zeroY = chartTop + positiveLeadHeight
    const chartWidth = dimensions.width - dimensions.paddingLeft - dimensions.paddingRight
    const positiveLeadPixelScale = maxBlueLead > 0
        ? positiveLeadHeight / maxBlueLead
        : Number.POSITIVE_INFINITY
    const negativeLeadPixelScale = maxRedLeadAbs > 0
        ? negativeLeadHeight / maxRedLeadAbs
        : Number.POSITIVE_INFINITY
    let goldToPixelScale = Math.min(positiveLeadPixelScale, negativeLeadPixelScale)
    if (!Number.isFinite(goldToPixelScale)) {
        if (Number.isFinite(positiveLeadPixelScale)) {
            goldToPixelScale = positiveLeadPixelScale
        } else if (Number.isFinite(negativeLeadPixelScale)) {
            goldToPixelScale = negativeLeadPixelScale
        } else {
            goldToPixelScale = 0
        }
    }

    const points = timelinePoints.map((point): GoldLeadGraphPoint => {
        const x = dimensions.paddingLeft + (point.elapsedSeconds / maxElapsedSeconds) * chartWidth
        const unsignedDistanceFromZero = Math.abs(point.lead) * goldToPixelScale
        const y = point.lead >= 0
            ? Math.max(chartTop, zeroY - unsignedDistanceFromZero)
            : Math.min(chartBottom, zeroY + unsignedDistanceFromZero)
        return {
            x,
            y,
            elapsedSeconds: point.elapsedSeconds,
            lead: point.lead,
        }
    })

    return {
        points,
        ticks: buildGoldGraphTicks(maxElapsedSeconds, dimensions),
        eventMarkers: buildGoldGraphEventMarkers(
            windowFrames,
            firstWindowTimestamp,
            maxElapsedSeconds,
            inferredHeraldKillCounts,
            inferredHeraldKillTimestampByTeam,
            dimensions,
        ),
        linePath: buildGoldGraphLinePath(points),
        positiveAreaPath: buildGoldGraphAreaPath(points, `positive`, zeroY),
        negativeAreaPath: buildGoldGraphAreaPath(points, `negative`, zeroY),
        zeroY,
        topLabel: formatGoldGraphAxisLabel(maxBlueLead),
        bottomLabel: formatGoldGraphAxisLabel(maxRedLeadAbs),
    }
}

function buildGoldLeadTimelinePoints(windowFrames: WindowFrame[], firstWindowTimestamp: string) {
    if (!Array.isArray(windowFrames) || windowFrames.length === 0) return []

    const normalizedFrames = windowFrames
        .map((frame) => ({ frame, timestampMs: Date.parse(frame.rfc460Timestamp) }))
        .filter((frameEntry) => Number.isFinite(frameEntry.timestampMs))
        .sort((leftEntry, rightEntry) => leftEntry.timestampMs - rightEntry.timestampMs)

    if (normalizedFrames.length === 0) return []

    const sampledFrameEntries: { frame: WindowFrame, timestampMs: number }[] = []
    let lastSampleTimestampMs = Number.NEGATIVE_INFINITY
    normalizedFrames.forEach((frameEntry, index) => {
        const isFirstSample = sampledFrameEntries.length === 0
        const previousSample = sampledFrameEntries[sampledFrameEntries.length - 1]
        if (previousSample && previousSample.timestampMs === frameEntry.timestampMs) return
        const isEnoughTimeElapsed = frameEntry.timestampMs - lastSampleTimestampMs >= GOLD_GRAPH_SAMPLING_INTERVAL_MS
        const isLastFrame = index === normalizedFrames.length - 1
        if (!isFirstSample && !isEnoughTimeElapsed && !isLastFrame) return

        sampledFrameEntries.push(frameEntry)
        lastSampleTimestampMs = frameEntry.timestampMs
    })

    const firstWindowTimestampMs = Date.parse(firstWindowTimestamp)
    const fallbackStartTimestampMs = sampledFrameEntries[0].timestampMs
    const gameStartTimestampMs = Number.isFinite(firstWindowTimestampMs)
        ? firstWindowTimestampMs
        : fallbackStartTimestampMs

    return sampledFrameEntries.map((frameEntry): GoldLeadTimelinePoint => {
        const lead = Number(frameEntry.frame.blueTeam.totalGold || 0) - Number(frameEntry.frame.redTeam.totalGold || 0)
        return {
            elapsedSeconds: Math.max(0, Math.floor((frameEntry.timestampMs - gameStartTimestampMs) / 1000)),
            lead,
        }
    })
}

function buildGoldGraphTicks(maxElapsedSeconds: number, dimensions: GoldGraphDimensions): GoldLeadGraphTick[] {
    if (maxElapsedSeconds <= 0) {
        return [{ seconds: 0, x: dimensions.paddingLeft, label: `0` }]
    }

    const chartWidth = dimensions.width - dimensions.paddingLeft - dimensions.paddingRight
    const tickCount = 6
    const ticks: GoldLeadGraphTick[] = []
    const seenMinuteLabels = new Set<string>()

    for (let tickIndex = 0; tickIndex < tickCount; tickIndex += 1) {
        const tickRatio = tickIndex / (tickCount - 1)
        const seconds = Math.round(maxElapsedSeconds * tickRatio)
        const x = dimensions.paddingLeft + tickRatio * chartWidth
        const minuteLabel = String(Math.round(seconds / 60))
        const shouldAlwaysKeep = tickIndex === 0 || tickIndex === tickCount - 1
        if (!shouldAlwaysKeep && seenMinuteLabels.has(minuteLabel)) continue

        seenMinuteLabels.add(minuteLabel)
        ticks.push({
            seconds,
            x,
            label: minuteLabel,
        })
    }

    return ticks
}

function buildGoldGraphLinePath(points: GoldLeadGraphPoint[]) {
    if (points.length === 0) return ``
    return points.map((point, index) => (
        `${index === 0 ? `M` : `L`} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`
    )).join(` `)
}

function buildGoldGraphEventMarkers(
    windowFrames: WindowFrame[],
    firstWindowTimestamp: string,
    maxElapsedSeconds: number,
    inferredHeraldKillCounts: { blue: number, red: number },
    inferredHeraldKillTimestampByTeam: { blue: string | null, red: string | null },
    dimensions: GoldGraphDimensions,
): GoldLeadGraphEventMarker[] {
    if (!Array.isArray(windowFrames) || windowFrames.length === 0) return []

    const normalizedFrames = windowFrames
        .map((frame) => ({ frame, timestampMs: Date.parse(frame.rfc460Timestamp) }))
        .filter((frameEntry) => Number.isFinite(frameEntry.timestampMs))
        .sort((leftEntry, rightEntry) => leftEntry.timestampMs - rightEntry.timestampMs)
    if (normalizedFrames.length < 2) return []

    const firstWindowTimestampMs = Date.parse(firstWindowTimestamp)
    const fallbackStartTimestampMs = normalizedFrames[0].timestampMs
    const gameStartTimestampMs = Number.isFinite(firstWindowTimestampMs)
        ? firstWindowTimestampMs
        : fallbackStartTimestampMs
    const chartWidth = dimensions.width - dimensions.paddingLeft - dimensions.paddingRight
    const pushEventMarkers: GoldLeadGraphEventMarker[] = []

    const createEventMarker = (teamKey: TeamKey, eventType: GoldGraphEventType, eventCount: number, eventTimestampMs: number) => {
        if (!Number.isFinite(eventTimestampMs)) return
        const elapsedSeconds = Math.max(0, Math.floor((eventTimestampMs - gameStartTimestampMs) / 1000))
        const normalizedElapsedSeconds = Math.min(Math.max(0, elapsedSeconds), maxElapsedSeconds)
        const x = dimensions.paddingLeft + (normalizedElapsedSeconds / Math.max(1, maxElapsedSeconds)) * chartWidth
        pushEventMarkers.push({
            x,
            elapsedSeconds: normalizedElapsedSeconds,
            team: teamKey,
            type: eventType,
            count: Math.max(1, eventCount),
        })
    }

    for (let frameIndex = 1; frameIndex < normalizedFrames.length; frameIndex += 1) {
        const previousFrame = normalizedFrames[frameIndex - 1].frame
        const nextFrameEntry = normalizedFrames[frameIndex]
        const nextFrame = nextFrameEntry.frame
        const eventTimestampMs = nextFrameEntry.timestampMs

        ;([`blue`, `red`] as TeamKey[]).forEach((teamKey) => {
            const previousTeam = teamKey === `blue` ? previousFrame.blueTeam : previousFrame.redTeam
            const nextTeam = teamKey === `blue` ? nextFrame.blueTeam : nextFrame.redTeam

            const towerDiff = Math.max(0, Number(nextTeam.towers || 0) - Number(previousTeam.towers || 0))
            if (towerDiff > 0) createEventMarker(teamKey, `tower`, towerDiff, eventTimestampMs)

            const baronDiff = Math.max(0, Number(nextTeam.barons || 0) - Number(previousTeam.barons || 0))
            if (baronDiff > 0) createEventMarker(teamKey, `baron`, baronDiff, eventTimestampMs)

            const previousDragonCount = Array.isArray(previousTeam.dragons) ? previousTeam.dragons.length : 0
            const nextDragonCount = Array.isArray(nextTeam.dragons) ? nextTeam.dragons.length : 0
            const dragonDiff = Math.max(0, nextDragonCount - previousDragonCount)
            if (dragonDiff > 0) createEventMarker(teamKey, `dragon`, dragonDiff, eventTimestampMs)
        })
    }

    ;([`blue`, `red`] as TeamKey[]).forEach((teamKey) => {
        if (!(Number(inferredHeraldKillCounts[teamKey] || 0) > 0)) return
        const explicitTimestamp = inferredHeraldKillTimestampByTeam[teamKey]
        const explicitTimestampMs = explicitTimestamp ? Date.parse(explicitTimestamp) : NaN
        const fallbackTimestampMs = gameStartTimestampMs + (14 * 60 * 1000)
        createEventMarker(
            teamKey,
            `herald`,
            Number(inferredHeraldKillCounts[teamKey] || 1),
            Number.isFinite(explicitTimestampMs) ? explicitTimestampMs : fallbackTimestampMs,
        )
    })

    return pushEventMarkers.sort((leftMarker, rightMarker) => leftMarker.elapsedSeconds - rightMarker.elapsedSeconds)
}

function buildGoldGraphAreaPath(points: GoldLeadGraphPoint[], areaType: `positive` | `negative`, zeroY: number) {
    if (points.length === 0) return ``

    const clippedPoints = points.map((point) => {
        if (areaType === `positive`) {
            return {
                x: point.x,
                y: point.lead > 0 ? point.y : zeroY,
            }
        }
        return {
            x: point.x,
            y: point.lead < 0 ? point.y : zeroY,
        }
    })

    const firstPoint = clippedPoints[0]
    const lastPoint = clippedPoints[clippedPoints.length - 1]
    let path = `M ${firstPoint.x.toFixed(2)} ${zeroY.toFixed(2)}`
    clippedPoints.forEach((point) => {
        path += ` L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`
    })
    path += ` L ${lastPoint.x.toFixed(2)} ${zeroY.toFixed(2)} Z`
    return path
}

function formatGoldGraphAxisLabel(goldDifference: number) {
    const safeGoldDifference = Math.max(0, Number(goldDifference) || 0)
    if (safeGoldDifference >= 1000) {
        const normalizedK = Math.round((safeGoldDifference / 1000) * 10) / 10
        const displayValue = Number.isInteger(normalizedK) ? normalizedK.toFixed(0) : normalizedK.toFixed(1)
        return `${displayValue}K`
    }
    return `${Math.round(safeGoldDifference)}`
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

function hasCsLeadAgainstLaneOpponent(player: WindowParticipant, frame: WindowFrame) {
    const playerParticipantId = Number(player.participantId || 0)
    if (!Number.isFinite(playerParticipantId) || playerParticipantId <= 0) return false

    const isBlueSidePlayer = playerParticipantId <= 5
    const laneOpponentParticipantId = isBlueSidePlayer
        ? playerParticipantId + 5
        : playerParticipantId - 5
    const opponentParticipants = isBlueSidePlayer
        ? frame.redTeam.participants
        : frame.blueTeam.participants
    const laneOpponent = opponentParticipants.find((participant) => Number(participant.participantId) === laneOpponentParticipantId)
    if (!laneOpponent) return false

    return Number(player.creepScore || 0) > Number(laneOpponent.creepScore || 0)
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

function getDragonOrSoulIcon(dragonRenderItem: DragonIconRenderItem, teamColor: string, index: number) {
    const normalizedDragonType = normalizeDragonType(dragonRenderItem.dragonType)
    if (dragonRenderItem.type === `soul`) {
        const soulImageSrc = DRAGON_SOUL_IMAGE_BY_TYPE[normalizedDragonType]
        if (!soulImageSrc) return null
        return (
            <img
                src={soulImageSrc}
                alt=""
                className="dragon dragon-soul"
                key={`${teamColor}_${index}_${normalizedDragonType}_soul`}
            />
        )
    }
    return getDragonSVG(normalizedDragonType, teamColor, index)
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

function getTeamKillCountFromParticipants(participants: WindowParticipant[] | undefined) {
    if (!Array.isArray(participants)) return 0
    return participants.reduce((sum, participant) => sum + Number(participant.kills || 0), 0)
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

function getDragonIconRenderItems(dragonTypes: string[] | undefined, reverseOrder = false) {
    const normalizedDragonTypes = getNormalizedDragonTypes(dragonTypes)
    const renderItems: DragonIconRenderItem[] = []
    const elementalDragonTypeCounts = new Map<string, number>()
    let elementalDragonKillCount = 0
    let shouldAppendSoulIcons = true

    normalizedDragonTypes.forEach((dragonType) => {
        renderItems.push({ type: `dragon`, dragonType })

        if (isElderDragonType(dragonType)) return

        elementalDragonKillCount += 1
        elementalDragonTypeCounts.set(dragonType, (elementalDragonTypeCounts.get(dragonType) || 0) + 1)

        if (!shouldAppendSoulIcons || elementalDragonKillCount < 4) return

        elementalDragonTypeCounts.forEach((count, elementalDragonType) => {
            if (count >= 2 && DRAGON_SOUL_IMAGE_BY_TYPE[elementalDragonType]) {
                renderItems.push({ type: `soul`, dragonType: elementalDragonType })
            }
        })
        shouldAppendSoulIcons = false
    })

    return reverseOrder ? renderItems.slice().reverse() : renderItems
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

