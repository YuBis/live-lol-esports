import './styles/playerStatusStyle.css'

import {
    getEventDetailsResponse,
    getISODateMultiplyOf10,
    getGameDetailsResponse,
    getGameDetailsSnapshotResponse,
    getWindowResponse,
    getScheduleResponse,
    getStandingsResponse,
    getDataDragonResponse,
    getDataDragonVersionsResponse,
    getFormattedPatchVersion,
    CHAMPIONS_JSON_URL,
    ITEMS_JSON_URL,
    RUNES_JSON_URL
} from "../../utils/LoLEsportsAPI";
import { BUILD_LABEL } from "../../utils/buildInfo";
import { ChangeEvent, useEffect, useRef, useState } from "react";
import Loading from '../../assets/images/loading.svg'
import { ReactComponent as TeamTBDSVG } from '../../assets/images/team-tbd.svg';
import { MatchDetails } from "./MatchDetails"
import { Game } from "./Game";
import { EventDetails, DetailsFrame, GameMetadata, Item, ObjectiveTimerBackfillSeed, Outcome, Record, Result, ScheduleEvent, Standing, WindowFrame, WindowParticipant, Rune, ExtendedVod } from "../types/baseTypes"
import { ChatToggler } from '../Navbar/ChatToggler';
import { TwitchEmbed, TwitchEmbedLayout } from 'twitch-player';
import { GameDetails } from './GameDetails';
import { StreamToggler } from '../Navbar/StreamToggler';
import { DisabledGame } from './DisabledGame';
import runesFallbackData from './styles/runes.json';

type MatchRouteProps = {
    match: {
        params: {
            gameid: string;
        }
    }
}

type DataDragonChampionSummary = {
    id: string;
    name: string;
}

type DataDragonChampionResponse = {
    data: {
        [championId: string]: DataDragonChampionSummary;
    };
}

type ChampionNameMap = {
    [championId: string]: string;
}

type ObservedDetailsItemsByParticipantId = Map<number, Set<number>>
type ParticipantRoleByParticipantId = Map<number, string>
type LastKnownBootItemByParticipantId = Map<number, number>
type LastKnownTrinketItemByParticipantId = Map<number, number>
type LastRawTrinketItemByParticipantId = Map<number, number>
type PendingHeraldTrinketDropCountByParticipantId = Map<number, number>
type HasObservedRawTrinketByParticipantId = Map<number, boolean>
type BackfillStatus = `idle` | `running` | `completed`
type InferredHeraldByTeam = {
    blue: boolean,
    red: boolean,
}
type InferredHeraldKillTimestampByTeam = {
    blue: string | null,
    red: string | null,
}
type MagicalFootwearTiming = {
    unlockAfterMs: number,
    takedownReductionMs: number,
}
const LIVE_DETAILS_BACKFILL_MINIMUM_GAME_TIME_MS = 5 * 60 * 1000
const LIVE_DETAILS_BACKFILL_FALLBACK_LOOKBACK_MS = 45 * 60 * 1000
const LIVE_DETAILS_BACKFILL_FALLBACK_MIN_AVERAGE_LEVEL = 6
const LIVE_DETAILS_BACKFILL_FALLBACK_MIN_TOTAL_GOLD = 20000
const LIVE_DETAILS_BACKFILL_QUERY_INTERVAL_MS = 10 * 1000
const LIVE_STATS_STARTING_TIME_STEP_MS = 10 * 1000
const OBJECTIVE_TIMER_BACKFILL_LOOKBACK_MS = 12 * 60 * 1000
const BARON_POWER_PLAY_DURATION_MS = 180 * 1000
const ELDER_DRAGON_BUFF_DURATION_MS = 150 * 1000
const WINDOW_PLAYBACK_IDLE_TICK_INTERVAL_MS = 50
const WINDOW_PLAYBACK_MIN_ACTIVE_TICK_INTERVAL_MS = 16
const WINDOW_PLAYBACK_MAX_ACTIVE_TICK_INTERVAL_MS = 1000
const WINDOW_PLAYBACK_BUFFER_RETENTION_MS = 90 * 1000
const DEBUG_SIMULATION_JUMP_STEP_MINUTES = 5
const ONE_MINUTE_MS = 60 * 1000
const TRINKET_FALLBACK_INFERENCE_MIN_GAME_TIME_MS = 30 * 1000
const MAGICAL_FOOTWEAR_RUNE_ID = 8304
const SLIGHTLY_MAGICAL_FOOTWEAR_ITEM_ID = 2422
const DEFAULT_MAGICAL_FOOTWEAR_TIMING: MagicalFootwearTiming = {
    unlockAfterMs: 12 * 60 * 1000,
    takedownReductionMs: 45 * 1000,
}

export function Match({ match }: MatchRouteProps) {
    const [eventDetails, setEventDetails] = useState<EventDetails>();
    const [firstWindowFrame, setFirstWindowFrame] = useState<WindowFrame>();
    const [lastDetailsFrame, setLastDetailsFrame] = useState<DetailsFrame>();
    const [lastWindowFrame, setLastWindowFrame] = useState<WindowFrame>();
    const [metadata, setMetadata] = useState<GameMetadata>();
    const [records, setRecords] = useState<Record[]>();
    const [results, setResults] = useState<Result[]>();
    const [currentGameOutcome, setCurrentGameOutcome] = useState<Array<Outcome>>();
    const [scheduleEvent, setScheduleEvent] = useState<ScheduleEvent>();
    const [gameIndex, setGameIndex] = useState<number>();
    const [items, setItems] = useState<Item[]>();
    const [runes, setRunes] = useState<Rune[]>();
    const [championNameMap, setChampionNameMap] = useState<ChampionNameMap>({});
    const [videoProvider, setVideoProvider] = useState<string>();
    const [videoParameter, setVideoParameter] = useState<string>();
    const [backfillStatus, setBackfillStatus] = useState<BackfillStatus>(`idle`);
    const [inferredHeraldKillCounts, setInferredHeraldKillCounts] = useState<{ blue: number, red: number }>({ blue: 0, red: 0 });
    const [inferredHeraldKillTimestampByTeam, setInferredHeraldKillTimestampByTeam] = useState<InferredHeraldKillTimestampByTeam>({ blue: null, red: null });
    const [objectiveTimerBackfillSeed, setObjectiveTimerBackfillSeed] = useState<ObjectiveTimerBackfillSeed>();
    const [playbackTimestamp, setPlaybackTimestamp] = useState<string>(``)
    const [windowFrameTimeline, setWindowFrameTimeline] = useState<WindowFrame[]>([])
    const [isDebugSimulationModeEnabled, setIsDebugSimulationModeEnabled] = useState<boolean>(false)
    const [isDebugSimulationRunning, setIsDebugSimulationRunning] = useState<boolean>(false)
    const [isDebugShowAllDataEnabled, setIsDebugShowAllDataEnabled] = useState<boolean>(false)
    const [debugSimulationJumpMinuteOptions, setDebugSimulationJumpMinuteOptions] = useState<number[]>([])
    const chatData = localStorage.getItem("chat");
    const chatEnabled = chatData ? chatData === `unmute` : false
    const streamData = localStorage.getItem("stream");
    const streamEnabled = streamData ? streamData === `unmute` : false

    const matchId = match.params.gameid;
    const matchEventDetailsRef = useRef<EventDetails>();
    const currentGameIndexRef = useRef<number>(1);
    const lastFrameSuccessRef = useRef<boolean>(false);
    const currentTimestampRef = useRef<string>(``);
    const latestWindowFrameTimestampRef = useRef<string>(``);
    const maxObservedWindowFrameTimestampByGameIdRef = useRef<Map<string, string>>(new Map())
    const bufferedWindowFramesByTimestampRef = useRef<Map<string, WindowFrame>>(new Map());
    const windowFrameTimelineByTimestampRef = useRef<Map<string, WindowFrame>>(new Map());
    const renderedWindowFrameTimestampRef = useRef<string>(``);
    const renderedWindowFrameRef = useRef<WindowFrame>();
    const playbackTimestampRef = useRef<string>(``)
    const lastDetailsTimestampRef = useRef<string>(``);
    const firstDetailsTimestampRef = useRef<string>(``);
    const lastDetailsFrameRef = useRef<DetailsFrame>();
    const observedDetailsItemsRef = useRef<ObservedDetailsItemsByParticipantId>(new Map())
    const participantRoleByParticipantIdRef = useRef<ParticipantRoleByParticipantId>(new Map())
    const lastKnownBootByParticipantIdRef = useRef<LastKnownBootItemByParticipantId>(new Map())
    const lastKnownTrinketByParticipantIdRef = useRef<LastKnownTrinketItemByParticipantId>(new Map())
    const lastRawTrinketByParticipantIdRef = useRef<LastRawTrinketItemByParticipantId>(new Map())
    const pendingHeraldTrinketDropCountByParticipantIdRef = useRef<PendingHeraldTrinketDropCountByParticipantId>(new Map())
    const hasObservedRawTrinketByParticipantIdRef = useRef<HasObservedRawTrinketByParticipantId>(new Map())
    const magicalFootwearTimingRef = useRef<MagicalFootwearTiming>(DEFAULT_MAGICAL_FOOTWEAR_TIMING)
    const inferredHeraldByTeamRef = useRef<InferredHeraldByTeam>({ blue: false, red: false })
    const inferredHeraldKillTimestampByTeamRef = useRef<InferredHeraldKillTimestampByTeam>({ blue: null, red: null })
    const backfillStatusByGameIdRef = useRef<Map<string, `running` | `completed`>>(new Map())
    const activeGameIdRef = useRef<string>(``)
    const firstWindowTimestampRef = useRef<string>(``)
    const firstWindowReceivedRef = useRef<boolean>(false);
    const championNamePatchRef = useRef<string>(``);
    const isDebugSimulationModeEnabledRef = useRef<boolean>(false)
    const isDebugSimulationRunningRef = useRef<boolean>(false)
    const debugSimulationStartedAtMsRef = useRef<number>(0)
    const debugSimulationGameStartTimestampRef = useRef<string>(``)
    const debugSimulationGameIdRef = useRef<string>(``)
    const pollingSessionIdRef = useRef<number>(0)

    useEffect(() => {
        isDebugSimulationModeEnabledRef.current = isDebugSimulationModeEnabled
        if (!isDebugSimulationModeEnabled) {
            isDebugSimulationRunningRef.current = false
            debugSimulationStartedAtMsRef.current = 0
            debugSimulationGameStartTimestampRef.current = ``
            debugSimulationGameIdRef.current = ``
            setDebugSimulationJumpMinuteOptions([])
            setIsDebugShowAllDataEnabled(false)
            if (isDebugSimulationRunning) {
                setIsDebugSimulationRunning(false)
            }
        }
    }, [isDebugSimulationModeEnabled, isDebugSimulationRunning])

    useEffect(() => {
        isDebugSimulationRunningRef.current = isDebugSimulationRunning
    }, [isDebugSimulationRunning])

    useEffect(() => {
        pollingSessionIdRef.current += 1
        const pollingSessionId = pollingSessionIdRef.current
        const isCurrentPollingSession = () => pollingSessionIdRef.current === pollingSessionId

        const resetRenderedGameState = () => {
            firstWindowReceivedRef.current = false
            setFirstWindowFrame(undefined)
            setLastWindowFrame(undefined)
            setMetadata(undefined)
            setCurrentGameOutcome(undefined)
            setLastDetailsFrame(undefined)
            setPlaybackTimestamp(``)
        }
        const resetWindowFrameTimeline = () => {
            windowFrameTimelineByTimestampRef.current = new Map()
            setWindowFrameTimeline([])
        }

        // Reset volatile per-game caches immediately on match route changes.
        matchEventDetailsRef.current = undefined
        currentTimestampRef.current = ``
        latestWindowFrameTimestampRef.current = ``
        maxObservedWindowFrameTimestampByGameIdRef.current = new Map()
        bufferedWindowFramesByTimestampRef.current = new Map()
        windowFrameTimelineByTimestampRef.current = new Map()
        renderedWindowFrameTimestampRef.current = ``
        renderedWindowFrameRef.current = undefined
        playbackTimestampRef.current = ``
        lastDetailsTimestampRef.current = ``
        firstDetailsTimestampRef.current = ``
        lastDetailsFrameRef.current = undefined
        observedDetailsItemsRef.current = new Map()
        participantRoleByParticipantIdRef.current = new Map()
        lastKnownBootByParticipantIdRef.current = new Map()
        lastKnownTrinketByParticipantIdRef.current = new Map()
        lastRawTrinketByParticipantIdRef.current = new Map()
        pendingHeraldTrinketDropCountByParticipantIdRef.current = new Map()
        hasObservedRawTrinketByParticipantIdRef.current = new Map()
        inferredHeraldByTeamRef.current = { blue: false, red: false }
        inferredHeraldKillTimestampByTeamRef.current = { blue: null, red: null }
        backfillStatusByGameIdRef.current = new Map()
        activeGameIdRef.current = ``
        firstWindowTimestampRef.current = ``
        firstWindowReceivedRef.current = false
        setBackfillStatus(`idle`)
        setInferredHeraldKillCounts({ blue: 0, red: 0 })
        setInferredHeraldKillTimestampByTeam({ blue: null, red: null })
        setObjectiveTimerBackfillSeed(undefined)
        setWindowFrameTimeline([])
        resetRenderedGameState()
        setDebugSimulationJumpMinuteOptions([])

        const initialGameIndex = getInitialGameIndex();
        if (initialGameIndex > 0) {
            currentGameIndexRef.current = initialGameIndex
        }
        getEventDetails();

        const POLL_INTERVAL_MS = 2000;
        const windowIntervalID = setInterval(() => {
            const matchEventDetails = matchEventDetailsRef.current
            if (!matchEventDetails) return

            let newGameIndex = getGameIndex(matchEventDetails)
            let gameId = matchEventDetails.match.games[newGameIndex - 1].id
            const hasGameIdChanged = activeGameIdRef.current !== `` && activeGameIdRef.current !== gameId
            if (currentGameIndexRef.current !== newGameIndex || hasGameIdChanged || !firstWindowReceivedRef.current) {
                currentTimestampRef.current = ``
                if (currentGameIndexRef.current !== newGameIndex || hasGameIdChanged) {
                    latestWindowFrameTimestampRef.current = ``
                    maxObservedWindowFrameTimestampByGameIdRef.current = new Map()
                    bufferedWindowFramesByTimestampRef.current = new Map()
                    resetWindowFrameTimeline()
                    renderedWindowFrameTimestampRef.current = ``
                    renderedWindowFrameRef.current = undefined
                    playbackTimestampRef.current = ``
                    lastDetailsTimestampRef.current = ``
                    firstDetailsTimestampRef.current = ``
                    lastDetailsFrameRef.current = undefined
                    observedDetailsItemsRef.current = new Map()
                    participantRoleByParticipantIdRef.current = new Map()
                    lastKnownBootByParticipantIdRef.current = new Map()
                    lastKnownTrinketByParticipantIdRef.current = new Map()
                    lastRawTrinketByParticipantIdRef.current = new Map()
                    pendingHeraldTrinketDropCountByParticipantIdRef.current = new Map()
                    hasObservedRawTrinketByParticipantIdRef.current = new Map()
                    inferredHeraldByTeamRef.current = { blue: false, red: false }
                    inferredHeraldKillTimestampByTeamRef.current = { blue: null, red: null }
                    setInferredHeraldKillCounts({ blue: 0, red: 0 })
                    setInferredHeraldKillTimestampByTeam({ blue: null, red: null })
                    backfillStatusByGameIdRef.current = new Map()
                    setBackfillStatus(`idle`)
                    setObjectiveTimerBackfillSeed(undefined)
                    firstWindowTimestampRef.current = ``
                    resetRenderedGameState()
                    setDebugSimulationJumpMinuteOptions([])
                }
                activeGameIdRef.current = gameId
                getFirstWindow(gameId)
                setGameIndex(newGameIndex)
                currentGameIndexRef.current = newGameIndex
            }
            const debugSimulationStartingTime = getDebugSimulationStartingTime(gameId)
            if (isDebugSimulationModeEnabledRef.current && isDebugSimulationRunningRef.current && !debugSimulationStartingTime) {
                return
            }
            getLiveWindow(gameId, debugSimulationStartingTime);
            getLastDetailsFrame(gameId, debugSimulationStartingTime);
        }, POLL_INTERVAL_MS);
        let windowPlaybackTimeoutID: ReturnType<typeof setTimeout> | undefined
        let isWindowPlaybackDisposed = false

        const scheduleWindowPlaybackDrain = (delayMs: number) => {
            if (isWindowPlaybackDisposed) return
            if (windowPlaybackTimeoutID !== undefined) {
                clearTimeout(windowPlaybackTimeoutID)
            }
            windowPlaybackTimeoutID = setTimeout(() => {
                const drainResult = drainBufferedWindowFramesForRender()
                scheduleWindowPlaybackDrain(
                    drainResult.renderedFrame
                        ? drainResult.nextDelayMs
                        : WINDOW_PLAYBACK_IDLE_TICK_INTERVAL_MS,
                )
            }, delayMs)
        }

        scheduleWindowPlaybackDrain(0)

        return () => {
            isWindowPlaybackDisposed = true
            clearInterval(windowIntervalID);
            if (windowPlaybackTimeoutID !== undefined) {
                clearTimeout(windowPlaybackTimeoutID)
            }
            pollingSessionIdRef.current += 1
        }

        function getEventDetails() {
            getEventDetailsResponse(matchId).then(response => {
                if (!isCurrentPollingSession()) return undefined
                let eventDetails: EventDetails = response.data.data.event;
                if (eventDetails === undefined) return undefined;
                let newGameIndex = getGameIndex(eventDetails)
                let gameId = eventDetails.match.games[newGameIndex - 1].id
                activeGameIdRef.current = gameId
                console.log(`Current Game ID: ${gameId}`)
                console.groupCollapsed(`Event Details`)
                console.log(eventDetails)
                console.groupEnd()
                setEventDetails(eventDetails)
                setGameIndex(newGameIndex)
                currentGameIndexRef.current = newGameIndex
                getFirstWindow(gameId)
                getScheduleEvent(eventDetails)
                getResults(eventDetails)
                matchEventDetailsRef.current = eventDetails
            })
        }

        function getInitialGameIndex(): number {
            let gameIndexMatch = window.location.href.match(/game-index\/(\d+)/)
            let initialGameIndex = gameIndexMatch ? parseInt(gameIndexMatch[1]) : 0
            console.log(`Initial Game Index: ${initialGameIndex}`)
            setGameIndex(initialGameIndex)
            return initialGameIndex
        }

        function getGameIndex(eventDetails: EventDetails): number {
            let gameIndexMatch = window.location.href.match(/game-index\/(\d+)/)
            let newGameIndex = gameIndexMatch ? parseInt(gameIndexMatch[1]) : getNextUnstartedGameIndex(eventDetails)
            setGameIndex(newGameIndex)
            return newGameIndex
        }

        function getScheduleEvent(eventDetails: EventDetails) {
            getScheduleResponse().then(response => {
                if (!isCurrentPollingSession()) return
                let scheduleEvents: ScheduleEvent[] = response.data.data.schedule.events
                let scheduleEvent = scheduleEvents.find((scheduleEvent: ScheduleEvent) => {
                    return scheduleEvent.match ? (scheduleEvent.match.id === matchId) : false
                })
                if (scheduleEvent === undefined) return
                let records = scheduleEvent.match.teams[0].record && scheduleEvent.match.teams[1].record ? [scheduleEvent.match.teams[0].record, scheduleEvent.match.teams[1].record] : undefined
                if (records === undefined) return

                console.groupCollapsed(`Schedule Event`)
                console.log(scheduleEvent)
                console.groupEnd()
                setRecords(records)
                setScheduleEvent(scheduleEvent);
            }).catch(error =>
                console.error(error)
            )
        }

        function getFirstWindow(gameId: string) {
            getWindowResponse(gameId).then(response => {
                if (!isCurrentPollingSession()) return
                if (response === undefined) return
                let frames: WindowFrame[] = response.data.frames;
                if (frames === undefined) return;

                console.groupCollapsed(`Meta Data`)
                console.log(response.data.gameMetadata)
                console.groupEnd()
                console.groupCollapsed(`First Frame`)
                console.log(frames[0])
                console.groupEnd()
                firstWindowReceivedRef.current = true
                firstWindowTimestampRef.current = normalizeTimestamp(frames[0].rfc460Timestamp)
                updateParticipantRoles(response.data.gameMetadata)
                setMetadata(response.data.gameMetadata)
                setFirstWindowFrame(frames[0])
                recordWindowFrameTimeline(gameId, frames)
                enqueueWindowFrames(gameId, frames)
                getItems(response.data.gameMetadata)
                getRunes(response.data.gameMetadata)
                getChampionNameMap(response.data.gameMetadata)
            });
        }

        function getLiveWindow(gameId: string, forcedStartingTime?: string) {
            const date = forcedStartingTime || (isCurrentGameCompleted()
                ? getCompletedGameSnapshotStartingTime(firstWindowTimestampRef.current)
                : getISODateMultiplyOf10());
            getWindowResponse(gameId, date).then(response => {
                if (!isCurrentPollingSession()) return
                if (response === undefined) return
                let frames: WindowFrame[] = response.data.frames;
                if (frames === undefined || frames.length === 0) return
                const lastWindowFrame = frames[frames.length - 1]
                const normalizedLastWindowTimestamp = normalizeTimestamp(lastWindowFrame.rfc460Timestamp)
                if (!normalizedLastWindowTimestamp) return
                if (
                    latestWindowFrameTimestampRef.current
                    && getTimestampValue(latestWindowFrameTimestampRef.current) > getTimestampValue(normalizedLastWindowTimestamp)
                ) {
                    return
                }
                currentTimestampRef.current = normalizedLastWindowTimestamp
                maybeStartLiveDetailsBackfill(gameId, lastWindowFrame)
                recordWindowFrameTimeline(gameId, frames)

                updateParticipantRoles(response.data.gameMetadata)
                const shouldRenderCompletedGameInstantly = isCurrentGameCompleted() && !isDebugSimulationRunningRef.current
                if (shouldRenderCompletedGameInstantly) {
                    updateObservedWindowTimestampAndJumpOptions(gameId, normalizedLastWindowTimestamp)
                    bufferedWindowFramesByTimestampRef.current = new Map()
                    renderedWindowFrameRef.current = lastWindowFrame
                    renderedWindowFrameTimestampRef.current = normalizedLastWindowTimestamp
                    if (playbackTimestampRef.current !== normalizedLastWindowTimestamp) {
                        playbackTimestampRef.current = normalizedLastWindowTimestamp
                        setPlaybackTimestamp(normalizedLastWindowTimestamp)
                    }
                    setLastWindowFrame(lastWindowFrame)
                } else {
                    enqueueWindowFrames(gameId, frames)
                }
                setMetadata(response.data.gameMetadata)

            });
        }

        function enqueueWindowFrames(gameId: string, frames: WindowFrame[]) {
            if (activeGameIdRef.current !== gameId) return
            const bufferedWindowFramesByTimestamp = bufferedWindowFramesByTimestampRef.current
            let newestTimestamp = latestWindowFrameTimestampRef.current

            frames.forEach((frame) => {
                const normalizedTimestamp = normalizeTimestamp(frame.rfc460Timestamp)
                if (!normalizedTimestamp) return

                const normalizedFrame = normalizedTimestamp === frame.rfc460Timestamp
                    ? frame
                    : { ...frame, rfc460Timestamp: normalizedTimestamp }
                bufferedWindowFramesByTimestamp.set(normalizedTimestamp, normalizedFrame)

                if (getTimestampValue(normalizedTimestamp) > getTimestampValue(newestTimestamp)) {
                    newestTimestamp = normalizedTimestamp
                }
            })

            updateObservedWindowTimestampAndJumpOptions(gameId, newestTimestamp)
            pruneBufferedWindowFrames(getTimestampValue(newestTimestamp))
        }

        function recordWindowFrameTimeline(gameId: string, frames: WindowFrame[]) {
            if (activeGameIdRef.current !== gameId) return
            if (!frames || frames.length === 0) return

            const windowFrameTimelineByTimestamp = windowFrameTimelineByTimestampRef.current
            let hasTimelineChange = false

            frames.forEach((frame) => {
                const normalizedTimestamp = normalizeTimestamp(frame.rfc460Timestamp)
                if (!normalizedTimestamp) return

                const normalizedFrame = normalizedTimestamp === frame.rfc460Timestamp
                    ? frame
                    : { ...frame, rfc460Timestamp: normalizedTimestamp }
                const previousFrame = windowFrameTimelineByTimestamp.get(normalizedTimestamp)
                const hasMeaningfulDiff = !previousFrame
                    || Number(previousFrame.blueTeam.totalGold || 0) !== Number(normalizedFrame.blueTeam.totalGold || 0)
                    || Number(previousFrame.redTeam.totalGold || 0) !== Number(normalizedFrame.redTeam.totalGold || 0)
                    || previousFrame.gameState !== normalizedFrame.gameState
                if (!hasMeaningfulDiff) return

                windowFrameTimelineByTimestamp.set(normalizedTimestamp, normalizedFrame)
                hasTimelineChange = true
            })

            if (!hasTimelineChange) return

            const sortedTimelineFrames = Array.from(windowFrameTimelineByTimestamp.entries())
                .sort((leftEntry, rightEntry) => getTimestampValue(leftEntry[0]) - getTimestampValue(rightEntry[0]))
                .map(([, frame]) => frame)
            setWindowFrameTimeline(sortedTimelineFrames)
        }

        function updateObservedWindowTimestampAndJumpOptions(gameId: string, newestTimestamp: string) {
            latestWindowFrameTimestampRef.current = newestTimestamp
            const previouslyObservedMaxTimestamp = maxObservedWindowFrameTimestampByGameIdRef.current.get(gameId) || ``
            const nextObservedMaxTimestamp = getTimestampValue(newestTimestamp) > getTimestampValue(previouslyObservedMaxTimestamp)
                ? newestTimestamp
                : previouslyObservedMaxTimestamp
            if (nextObservedMaxTimestamp) {
                maxObservedWindowFrameTimestampByGameIdRef.current.set(gameId, nextObservedMaxTimestamp)
            }

            const nextDebugSimulationJumpMinuteOptions = getDebugSimulationJumpMinuteOptions(
                firstWindowTimestampRef.current,
                nextObservedMaxTimestamp || newestTimestamp,
            )
            setDebugSimulationJumpMinuteOptions((previousOptions) => (
                areNumberArraysEqual(previousOptions, nextDebugSimulationJumpMinuteOptions)
                    ? previousOptions
                    : nextDebugSimulationJumpMinuteOptions
            ))
        }

        function pruneBufferedWindowFrames(latestWindowTimestampValue: number) {
            if (latestWindowTimestampValue <= 0) return
            const renderedWindowFrameTimestampValue = getTimestampValue(renderedWindowFrameTimestampRef.current)
            const staleThresholdTimestampValue = latestWindowTimestampValue - WINDOW_PLAYBACK_BUFFER_RETENTION_MS

            bufferedWindowFramesByTimestampRef.current.forEach((_, timestamp) => {
                const timestampValue = getTimestampValue(timestamp)
                if (timestampValue < renderedWindowFrameTimestampValue && timestampValue < staleThresholdTimestampValue) {
                    bufferedWindowFramesByTimestampRef.current.delete(timestamp)
                }
            })
        }

        function drainBufferedWindowFramesForRender() {
            if (bufferedWindowFramesByTimestampRef.current.size === 0) {
                return {
                    renderedFrame: false,
                    nextDelayMs: WINDOW_PLAYBACK_IDLE_TICK_INTERVAL_MS,
                }
            }

            const sortedWindowFrameEntries = Array.from(bufferedWindowFramesByTimestampRef.current.entries()).sort((leftEntry, rightEntry) => (
                getTimestampValue(leftEntry[0]) - getTimestampValue(rightEntry[0])
            ))
            const renderedWindowFrameTimestampValue = getTimestampValue(renderedWindowFrameTimestampRef.current)
            const renderTargetTimestampValue = Date.now()

            let nextWindowFrameToProcess: WindowFrame | undefined
            let nextWindowFrameTimestampToProcess: string | undefined
            sortedWindowFrameEntries.forEach(([timestamp, frame]) => {
                if (nextWindowFrameToProcess) return

                const timestampValue = getTimestampValue(timestamp)
                if (timestampValue <= renderedWindowFrameTimestampValue) return
                if (timestampValue > renderTargetTimestampValue) return

                nextWindowFrameToProcess = frame
                nextWindowFrameTimestampToProcess = timestamp
            })

            if (!nextWindowFrameToProcess || !nextWindowFrameTimestampToProcess) {
                return {
                    renderedFrame: false,
                    nextDelayMs: WINDOW_PLAYBACK_IDLE_TICK_INTERVAL_MS,
                }
            }

            renderedWindowFrameTimestampRef.current = nextWindowFrameTimestampToProcess
            if (nextWindowFrameTimestampToProcess !== playbackTimestampRef.current) {
                playbackTimestampRef.current = nextWindowFrameTimestampToProcess
                setPlaybackTimestamp(nextWindowFrameTimestampToProcess)
            }

            const shouldRenderWindowFrame = hasRenderableWindowFrameDiff(renderedWindowFrameRef.current, nextWindowFrameToProcess)
            if (shouldRenderWindowFrame) {
                renderedWindowFrameRef.current = nextWindowFrameToProcess
                setLastWindowFrame(nextWindowFrameToProcess)
            }

            const latestRenderedTimestampValue = getTimestampValue(renderedWindowFrameTimestampRef.current)
            const oldestBufferedTimestampToKeep = latestRenderedTimestampValue - WINDOW_PLAYBACK_BUFFER_RETENTION_MS
            bufferedWindowFramesByTimestampRef.current.forEach((_, timestamp) => {
                if (getTimestampValue(timestamp) < oldestBufferedTimestampToKeep) {
                    bufferedWindowFramesByTimestampRef.current.delete(timestamp)
                }
            })

            return {
                renderedFrame: true,
                nextDelayMs: getPlaybackActiveDelayMs(renderedWindowFrameTimestampValue, latestRenderedTimestampValue),
            }
        }

        function getLastDetailsFrame(gameId: string, forcedStartingTime?: string) {
            const date = forcedStartingTime || (isCurrentGameCompleted()
                ? getCompletedGameSnapshotStartingTime(firstWindowTimestampRef.current)
                : getISODateMultiplyOf10());
            getGameDetailsResponse(gameId, date, lastFrameSuccessRef.current).then(response => {
                if (!isCurrentPollingSession()) return
                lastFrameSuccessRef.current = false
                if (response === undefined) return
                let frames: DetailsFrame[] = response.data.frames;
                if (frames === undefined || frames.length === 0) return;

                const incomingLastFrame = frames[frames.length - 1]
                const incomingTimestamp = getTimestampValue(incomingLastFrame.rfc460Timestamp)
                const currentTimestamp = getTimestampValue(lastDetailsTimestampRef.current)

                // Ignore stale details responses that arrive out-of-order.
                if (incomingTimestamp !== 0 && currentTimestamp !== 0 && incomingTimestamp < currentTimestamp) return

                if (!firstDetailsTimestampRef.current) {
                    firstDetailsTimestampRef.current = normalizeTimestamp(incomingLastFrame.rfc460Timestamp)
                }
                const previousInferredHeraldByTeam: InferredHeraldByTeam = {
                    blue: inferredHeraldByTeamRef.current.blue,
                    red: inferredHeraldByTeamRef.current.red,
                }
                const stabilizedFrame = stabilizeDetailsFrame(
                    incomingLastFrame,
                    lastDetailsFrameRef.current,
                    observedDetailsItemsRef.current,
                    participantRoleByParticipantIdRef.current,
                    lastKnownBootByParticipantIdRef.current,
                    isCurrentGameCompleted(),
                    lastKnownTrinketByParticipantIdRef.current,
                    lastRawTrinketByParticipantIdRef.current,
                    getElapsedGameTimeMs(firstWindowTimestampRef.current, incomingLastFrame.rfc460Timestamp),
                    inferredHeraldByTeamRef.current,
                    pendingHeraldTrinketDropCountByParticipantIdRef.current,
                    hasObservedRawTrinketByParticipantIdRef.current,
                    magicalFootwearTimingRef.current,
                )
                maybeRecordInferredHeraldKillTimestampOnTransition(
                    gameId,
                    incomingLastFrame.rfc460Timestamp,
                    previousInferredHeraldByTeam,
                )
                setInferredHeraldKillCounts({
                    blue: inferredHeraldByTeamRef.current.blue ? 1 : 0,
                    red: inferredHeraldByTeamRef.current.red ? 1 : 0,
                })
                lastFrameSuccessRef.current = true
                lastDetailsFrameRef.current = stabilizedFrame
                lastDetailsTimestampRef.current = normalizeTimestamp(incomingLastFrame.rfc460Timestamp)
                setLastDetailsFrame(stabilizedFrame)
            });
        }

        function getDebugSimulationStartingTime(gameId: string) {
            if (!isDebugSimulationModeEnabledRef.current || !isDebugSimulationRunningRef.current) return undefined

            if (debugSimulationGameIdRef.current !== gameId) {
                debugSimulationGameIdRef.current = gameId
                debugSimulationGameStartTimestampRef.current = normalizeTimestamp(firstWindowTimestampRef.current)
                debugSimulationStartedAtMsRef.current = Date.now()
            }

            if (!debugSimulationGameStartTimestampRef.current) {
                const normalizedFirstWindowTimestamp = normalizeTimestamp(firstWindowTimestampRef.current)
                if (!normalizedFirstWindowTimestamp) return undefined
                debugSimulationGameStartTimestampRef.current = normalizedFirstWindowTimestamp
                debugSimulationStartedAtMsRef.current = Date.now()
            }

            const simulationStartTimestampValue = getTimestampValue(debugSimulationGameStartTimestampRef.current)
            if (simulationStartTimestampValue === 0) return undefined

            const elapsedMs = Math.max(0, Date.now() - debugSimulationStartedAtMsRef.current)
            const simulatedCurrentTimestampValue = simulationStartTimestampValue + elapsedMs
            const alignedSimulatedTimestampValue = alignTimestampToLiveStatsStep(simulatedCurrentTimestampValue)
            const queryTimestampValue = alignedSimulatedTimestampValue > 0
                ? alignedSimulatedTimestampValue
                : simulationStartTimestampValue
            return new Date(queryTimestampValue).toISOString()
        }

        function isCurrentGameCompleted() {
            const matchEventDetails = matchEventDetailsRef.current
            if (!matchEventDetails) return false
            const currentGame = matchEventDetails.match.games[currentGameIndexRef.current - 1]
            return currentGame?.state === `completed`
        }

        function updateParticipantRoles(gameMetadata: GameMetadata) {
            const participantRoleByParticipantId = new Map<number, string>()
            gameMetadata.blueTeamMetadata.participantMetadata.forEach((participantMetadata) => {
                participantRoleByParticipantId.set(participantMetadata.participantId, participantMetadata.role)
            })
            gameMetadata.redTeamMetadata.participantMetadata.forEach((participantMetadata) => {
                participantRoleByParticipantId.set(participantMetadata.participantId, participantMetadata.role)
            })
            participantRoleByParticipantIdRef.current = participantRoleByParticipantId
        }

        function maybeRecordInferredHeraldKillTimestampOnTransition(
            gameId: string,
            timestamp: string | Date,
            previousInferredHeraldByTeam: InferredHeraldByTeam,
        ) {
            ;([`blue`, `red`] as Array<keyof InferredHeraldByTeam>).forEach((teamKey) => {
                const isTransitionToInferredHeraldKill =
                    !previousInferredHeraldByTeam[teamKey]
                    && inferredHeraldByTeamRef.current[teamKey]
                if (!isTransitionToInferredHeraldKill) return
                maybeRecordInferredHeraldKillTimestamp(gameId, teamKey, timestamp)
            })
        }

        function maybeRecordInferredHeraldKillTimestamp(
            gameId: string,
            teamKey: keyof InferredHeraldByTeam,
            timestamp: string | Date,
        ) {
            if (activeGameIdRef.current !== gameId) return
            const normalizedTimestamp = normalizeTimestamp(timestamp)
            if (!normalizedTimestamp) return

            const currentTimestamp = inferredHeraldKillTimestampByTeamRef.current[teamKey]
            if (currentTimestamp) return
            inferredHeraldKillTimestampByTeamRef.current[teamKey] = normalizedTimestamp
            setInferredHeraldKillTimestampByTeam({
                blue: inferredHeraldKillTimestampByTeamRef.current.blue,
                red: inferredHeraldKillTimestampByTeamRef.current.red,
            })
        }

        function maybeStartLiveDetailsBackfill(gameId: string, lastWindowFrame: WindowFrame) {
            if (!activeGameIdRef.current) {
                activeGameIdRef.current = gameId
            }
            if (activeGameIdRef.current !== gameId) return

            const backfillStatus = backfillStatusByGameIdRef.current.get(gameId)
            if (backfillStatus === `running` || backfillStatus === `completed`) return

            const matchEventDetails = matchEventDetailsRef.current
            if (!matchEventDetails) return
            const currentGame = matchEventDetails.match.games[currentGameIndexRef.current - 1]
            if (!currentGame || currentGame.id !== gameId) return
            const isCompletedGame = currentGame.state === `completed` || lastWindowFrame.gameState === `finished`
            const isWindowInPlayableState = lastWindowFrame.gameState === `in_game` || lastWindowFrame.gameState === `finished`
            if (!isWindowInPlayableState && !isCompletedGame) return

            const startTimestampValue = getTimestampValue(firstWindowTimestampRef.current)
            const windowTimestampValue = getTimestampValue(lastWindowFrame.rfc460Timestamp)
            const detailsTimestampValue = getTimestampValue(lastDetailsTimestampRef.current)
            if (isCompletedGame && detailsTimestampValue === 0 && windowTimestampValue === 0) return
            const currentTimestampValue = Math.max(windowTimestampValue, detailsTimestampValue)
            const backfillStartTimestampValue = getLiveDetailsBackfillStartTimestampValue(
                startTimestampValue,
                currentTimestampValue,
                currentGame,
                lastWindowFrame,
            )
            if (backfillStartTimestampValue === 0) {
                // Keep waiting in "pending" state until timeline timestamps become available.
                // Some refresh paths briefly return skeletal payloads before full sync catches up.
                // Marking "completed" here prevents future retries and can freeze backfill forever.
                return
            }

            updateBackfillStatus(gameId, `running`)
            void backfillObservedItemsFromGameStart(gameId, backfillStartTimestampValue, currentTimestampValue)
        }

        async function backfillObservedItemsFromGameStart(gameId: string, startTimestampValue: number, endTimestampValue: number) {
            if (!isCurrentPollingSession()) return
            const alignedStart = alignTimestampToLiveStatsStep(startTimestampValue)
            const alignedEnd = alignTimestampToLiveStatsStep(endTimestampValue)
            if (alignedStart === 0 || alignedEnd === 0 || alignedEnd < alignedStart) {
                updateBackfillStatus(gameId, `completed`)
                return
            }

            const previousRawItemsByParticipantId = new Map<number, number[]>()
            const previousRawTrinketByParticipantId = new Map<number, number>()
            const pendingRawTrinketDropCountByParticipantId = new Map<number, number>()
            let aborted = false
            try {
                const historicalWindowFrames = await backfillWindowTimelineFromHistory(gameId, alignedStart, alignedEnd)
                if (!isCurrentPollingSession()) {
                    aborted = true
                }
                if (activeGameIdRef.current !== gameId) {
                    aborted = true
                }
                if (aborted) return

                const objectiveSeedFromHistoricalWindowFrames = historicalWindowFrames.length > 0
                    ? buildObjectiveTimerBackfillSeedFromWindowFrames(historicalWindowFrames, alignedEnd)
                    : undefined
                if (objectiveSeedFromHistoricalWindowFrames) {
                    setObjectiveTimerBackfillSeed(objectiveSeedFromHistoricalWindowFrames)
                } else {
                    await backfillObjectiveTimersFromWindowHistory(gameId, alignedStart, alignedEnd)
                    if (!isCurrentPollingSession()) {
                        aborted = true
                    }
                    if (activeGameIdRef.current !== gameId) {
                        aborted = true
                    }
                    if (aborted) return
                }

                for (let cursor = alignedStart; cursor <= alignedEnd; cursor += LIVE_DETAILS_BACKFILL_QUERY_INTERVAL_MS) {
                    if (!isCurrentPollingSession()) {
                        aborted = true
                        break
                    }
                    if (activeGameIdRef.current !== gameId) {
                        aborted = true
                        break
                    }

                    const queryTimestamp = new Date(cursor).toISOString()
                    const response = await getGameDetailsSnapshotResponse(gameId, queryTimestamp)
                    if (!response) continue
                    if (!isCurrentPollingSession()) {
                        aborted = true
                        break
                    }
                    if (activeGameIdRef.current !== gameId) {
                        aborted = true
                        break
                    }

                    const frames: DetailsFrame[] = response.data.frames
                    if (!frames || frames.length === 0) continue

                    frames.forEach((frame) => {
                        frame.participants.forEach((participant) => {
                            const participantId = participant.participantId
                            const rawItemIds = sanitizeItemIds(participant.items)
                            const currentRawTrinketItemId = getTrinketItemId(rawItemIds)
                            const previousRawItemIds = previousRawItemsByParticipantId.get(participantId) || []
                            const previousRawTrinketItemId = previousRawTrinketByParticipantId.get(participantId)
                            const hadObservedRawTrinketBeforeFrame = hasObservedRawTrinketByParticipantIdRef.current.get(participantId) === true
                            if (currentRawTrinketItemId !== undefined) {
                                hasObservedRawTrinketByParticipantIdRef.current.set(participantId, true)
                            }

                            const observedItems = getObservedItemsForParticipant(observedDetailsItemsRef.current, participant.participantId)
                            recordObservedItems(observedItems, rawItemIds)

                            if (currentRawTrinketItemId === undefined) {
                                const droppedItemIds = getDroppedItemIds(previousRawItemIds, rawItemIds)
                                const hasRawTrinketDrop =
                                    previousRawTrinketItemId !== undefined
                                    && droppedItemIds.includes(previousRawTrinketItemId)
                                const previousPendingCount = pendingRawTrinketDropCountByParticipantId.get(participantId) || 0
                                let nextPendingCount = 0
                                if (hasRawTrinketDrop) {
                                    nextPendingCount = 1
                                } else if (previousPendingCount > 0) {
                                    nextPendingCount = Math.min(previousPendingCount + 1, 2)
                                }

                                if (nextPendingCount > 0) {
                                    pendingRawTrinketDropCountByParticipantId.set(participantId, nextPendingCount)
                                } else {
                                    pendingRawTrinketDropCountByParticipantId.delete(participantId)
                                }

                                const inferredHeraldCapture =
                                    hadObservedRawTrinketBeforeFrame
                                    && previousPendingCount === 1
                                    && nextPendingCount === 2
                                if (inferredHeraldCapture) {
                                    const inferredTeamColor = participantId <= 5 ? `blue` : `red`
                                    const oppositeTeamColor = inferredTeamColor === `blue` ? `red` : `blue`
                                    if (!inferredHeraldByTeamRef.current[inferredTeamColor] && !inferredHeraldByTeamRef.current[oppositeTeamColor]) {
                                        inferredHeraldByTeamRef.current[inferredTeamColor] = true
                                        maybeRecordInferredHeraldKillTimestamp(gameId, inferredTeamColor, frame.rfc460Timestamp)
                                        if (activeGameIdRef.current === gameId) {
                                            setInferredHeraldKillCounts({
                                                blue: inferredHeraldByTeamRef.current.blue ? 1 : 0,
                                                red: inferredHeraldByTeamRef.current.red ? 1 : 0,
                                            })
                                        }
                                    }
                                }
                            } else {
                                pendingRawTrinketDropCountByParticipantId.delete(participantId)
                            }

                            previousRawItemsByParticipantId.set(participantId, rawItemIds)
                            if (currentRawTrinketItemId !== undefined) {
                                previousRawTrinketByParticipantId.set(participantId, currentRawTrinketItemId)
                            } else {
                                previousRawTrinketByParticipantId.delete(participantId)
                            }
                        })
                    })
                }
            } finally {
                if (!aborted && isCurrentPollingSession() && activeGameIdRef.current === gameId) {
                    updateBackfillStatus(gameId, `completed`)
                }
            }
        }

        async function backfillWindowTimelineFromHistory(gameId: string, alignedStartTimestampValue: number, alignedEndTimestampValue: number) {
            if (!isCurrentPollingSession()) return []
            if (activeGameIdRef.current !== gameId) return []

            const framesByTimestamp = new Map<string, WindowFrame>()

            for (let cursor = alignedStartTimestampValue; cursor <= alignedEndTimestampValue; cursor += LIVE_DETAILS_BACKFILL_QUERY_INTERVAL_MS) {
                if (!isCurrentPollingSession()) return []
                if (activeGameIdRef.current !== gameId) return []

                const queryTimestamp = new Date(cursor).toISOString()
                const response = await getWindowResponse(gameId, queryTimestamp)
                if (!response) continue
                if (!isCurrentPollingSession()) return []
                if (activeGameIdRef.current !== gameId) return []

                const incomingFrames: WindowFrame[] = response.data?.frames
                if (!incomingFrames || incomingFrames.length === 0) continue

                incomingFrames.forEach((frame) => {
                    const normalizedTimestamp = normalizeTimestamp(frame.rfc460Timestamp)
                    if (!normalizedTimestamp) return
                    const normalizedFrame = normalizedTimestamp === frame.rfc460Timestamp
                        ? frame
                        : { ...frame, rfc460Timestamp: normalizedTimestamp }
                    framesByTimestamp.set(normalizedTimestamp, normalizedFrame)
                })
            }

            const frames = Array.from(framesByTimestamp.entries())
                .sort((leftEntry, rightEntry) => getTimestampValue(leftEntry[0]) - getTimestampValue(rightEntry[0]))
                .map(([, frame]) => frame)
            if (frames.length === 0) return []
            if (!isCurrentPollingSession()) return []
            if (activeGameIdRef.current !== gameId) return []

            recordWindowFrameTimeline(gameId, frames)
            return frames
        }

        async function backfillObjectiveTimersFromWindowHistory(gameId: string, alignedStartTimestampValue: number, alignedEndTimestampValue: number) {
            if (!isCurrentPollingSession()) return
            if (activeGameIdRef.current !== gameId) return

            const effectiveHistoryStartTimestampValue = Math.max(
                alignedStartTimestampValue,
                alignedEndTimestampValue - OBJECTIVE_TIMER_BACKFILL_LOOKBACK_MS,
            )
            const framesByTimestamp = new Map<string, WindowFrame>()

            for (let cursor = effectiveHistoryStartTimestampValue; cursor <= alignedEndTimestampValue; cursor += LIVE_DETAILS_BACKFILL_QUERY_INTERVAL_MS) {
                if (!isCurrentPollingSession()) return
                if (activeGameIdRef.current !== gameId) return

                const queryTimestamp = new Date(cursor).toISOString()
                const response = await getWindowResponse(gameId, queryTimestamp)
                if (!response) continue
                if (!isCurrentPollingSession()) return
                if (activeGameIdRef.current !== gameId) return

                const incomingFrames: WindowFrame[] = response.data?.frames
                if (!incomingFrames || incomingFrames.length === 0) continue

                incomingFrames.forEach((frame) => {
                    const normalizedTimestamp = normalizeTimestamp(frame.rfc460Timestamp)
                    if (!normalizedTimestamp) return
                    framesByTimestamp.set(normalizedTimestamp, frame)
                })
            }

            const frames = Array.from(framesByTimestamp.values())
            if (frames.length === 0) return

            const seed = buildObjectiveTimerBackfillSeedFromWindowFrames(frames, alignedEndTimestampValue)
            if (!seed) return
            if (!isCurrentPollingSession()) return
            if (activeGameIdRef.current !== gameId) return

            setObjectiveTimerBackfillSeed(seed)
        }

        function updateBackfillStatus(gameId: string, status: `running` | `completed`) {
            if (!isCurrentPollingSession()) return
            backfillStatusByGameIdRef.current.set(gameId, status)
            if (activeGameIdRef.current === gameId) {
                setBackfillStatus(status)
            }
        }

        function getResults(eventDetails: EventDetails) {
            if (eventDetails === undefined) return;
            getStandingsResponse(eventDetails.tournament.id).then(response => {
                if (!isCurrentPollingSession()) return
                let standings: Standing[] = response.data.data.standings
                let stage = standings[0].stages.find((stage) => {
                    let stageSection = stage.sections.find((section) => {
                        return section.matches.find((match) => match.id === matchId)
                    })
                    return stageSection
                })
                if (stage === undefined) return;
                let section = stage.sections.find((section) => {
                    return section.matches.find((match) => match.id === matchId)
                })
                if (section === undefined) return;
                let match = section.matches.find((match) => match.id === matchId)
                if (match === undefined) return;
                let teams = match.teams
                let results = teams.map((team) => team.result)
                setResults(results)
                console.groupCollapsed(`Results`)
                console.log(results)
                console.groupEnd()
            });
        }

        function getItems(metadata: GameMetadata) {
            const formattedPatchVersion = getFormattedPatchVersion(metadata.patchVersion)
            getDataDragonResponse(ITEMS_JSON_URL, formattedPatchVersion).then(response => {
                if (!isCurrentPollingSession()) return
                setItems(response.data.data)
            })
        }
        async function getRunes(metadata: GameMetadata) {
            if (!isCurrentPollingSession()) return
            const formattedPatchVersion = getFormattedPatchVersion(metadata.patchVersion)
            const patchMajorMinorVersion = getPatchMajorMinorVersion(metadata.patchVersion)
            const candidateVersions = await getDataDragonRuneVersionCandidates(formattedPatchVersion, patchMajorMinorVersion)
            if (!isCurrentPollingSession()) return

            const runeDataUrlCandidates = getRuneDataUrlCandidates(candidateVersions)
            for (const runeDataUrlCandidate of runeDataUrlCandidates) {
                try {
                    const response = await getDataDragonResponse(runeDataUrlCandidate.jsonUrl, runeDataUrlCandidate.version)
                    if (!isCurrentPollingSession()) return
                    const incomingRunes = response.data
                    if (!Array.isArray(incomingRunes) || incomingRunes.length === 0) continue
                    setRunes(incomingRunes)
                    magicalFootwearTimingRef.current = getMagicalFootwearTimingFromRunes(incomingRunes)
                    return
                } catch (error) {
                    console.error(`Failed to load runes for ${runeDataUrlCandidate.version} (${runeDataUrlCandidate.locale})`, error)
                }
            }

            const fallbackRunes = runesFallbackData as unknown as Rune[]
            if (!isCurrentPollingSession()) return
            setRunes(fallbackRunes)
            magicalFootwearTimingRef.current = getMagicalFootwearTimingFromRunes(fallbackRunes)
        }

        function getChampionNameMap(metadata: GameMetadata) {
            const formattedPatchVersion = getFormattedPatchVersion(metadata.patchVersion)
            if (championNamePatchRef.current === formattedPatchVersion) return

            getDataDragonResponse(CHAMPIONS_JSON_URL, formattedPatchVersion).then(response => {
                if (!isCurrentPollingSession()) return
                const championResponse: DataDragonChampionResponse = response.data
                const newChampionNameMap: ChampionNameMap = {}

                Object.values(championResponse.data).forEach((championSummary) => {
                    newChampionNameMap[championSummary.id] = championSummary.name
                })

                setChampionNameMap(newChampionNameMap)
                championNamePatchRef.current = formattedPatchVersion
            }).catch((error) => {
                console.error(error)
            })
        }

    }, [matchId]);

    useEffect(() => {
        if (!eventDetails || !lastWindowFrame || !gameIndex) return
        setCurrentGameOutcome(getCurrentGameOutcomeFromRenderedWindowFrame(eventDetails, gameIndex, lastWindowFrame))
    }, [eventDetails, gameIndex, lastWindowFrame])

    function handleDebugSimulationModeChange(isEnabled: boolean) {
        setIsDebugSimulationModeEnabled(isEnabled)
        if (!isEnabled) {
            setIsDebugSimulationRunning(false)
            setIsDebugShowAllDataEnabled(false)
        }
    }

    function handleDebugShowAllDataChange(isEnabled: boolean) {
        if (!isDebugSimulationModeEnabled) return
        setIsDebugShowAllDataEnabled(isEnabled)
    }

    function resetSimulationPlaybackAndDerivedState() {
        currentTimestampRef.current = ``
        latestWindowFrameTimestampRef.current = ``
        bufferedWindowFramesByTimestampRef.current = new Map()
        windowFrameTimelineByTimestampRef.current = new Map()
        renderedWindowFrameTimestampRef.current = ``
        renderedWindowFrameRef.current = undefined
        playbackTimestampRef.current = ``
        lastFrameSuccessRef.current = false
        lastDetailsTimestampRef.current = ``
        firstDetailsTimestampRef.current = ``
        lastDetailsFrameRef.current = undefined
        observedDetailsItemsRef.current = new Map()
        participantRoleByParticipantIdRef.current = new Map()
        lastKnownBootByParticipantIdRef.current = new Map()
        lastKnownTrinketByParticipantIdRef.current = new Map()
        lastRawTrinketByParticipantIdRef.current = new Map()
        pendingHeraldTrinketDropCountByParticipantIdRef.current = new Map()
        hasObservedRawTrinketByParticipantIdRef.current = new Map()
        inferredHeraldByTeamRef.current = { blue: false, red: false }
        inferredHeraldKillTimestampByTeamRef.current = { blue: null, red: null }
        backfillStatusByGameIdRef.current = new Map()

        setInferredHeraldKillCounts({ blue: 0, red: 0 })
        setInferredHeraldKillTimestampByTeam({ blue: null, red: null })
        setBackfillStatus(`idle`)
        setObjectiveTimerBackfillSeed(undefined)
        setWindowFrameTimeline([])
        setLastDetailsFrame(undefined)
        setPlaybackTimestamp(``)
    }

    function handleDebugSimulationButtonClick() {
        if (!isDebugSimulationModeEnabled) return
        if (isDebugSimulationRunning) {
            setIsDebugSimulationRunning(false)
            return
        }

        isDebugSimulationRunningRef.current = true
        debugSimulationGameIdRef.current = activeGameIdRef.current
        debugSimulationGameStartTimestampRef.current = normalizeTimestamp(firstWindowTimestampRef.current)
        debugSimulationStartedAtMsRef.current = Date.now()
        resetSimulationPlaybackAndDerivedState()
        setIsDebugSimulationRunning(true)
    }

    function handleDebugSimulationJumpToMinute(targetMinute: number) {
        if (!isDebugSimulationModeEnabled || !isDebugSimulationRunning) return
        if (!Number.isFinite(targetMinute) || targetMinute <= 0) return

        const targetIsInRange = debugSimulationJumpMinuteOptions.includes(targetMinute)
        if (!targetIsInRange) return

        const normalizedGameStartTimestamp = normalizeTimestamp(firstWindowTimestampRef.current)
        const activeGameId = activeGameIdRef.current
        if (!normalizedGameStartTimestamp || !activeGameId) return

        const targetElapsedMs = targetMinute * ONE_MINUTE_MS

        isDebugSimulationRunningRef.current = true
        debugSimulationGameIdRef.current = activeGameId
        debugSimulationGameStartTimestampRef.current = normalizedGameStartTimestamp
        debugSimulationStartedAtMsRef.current = Date.now() - targetElapsedMs
        resetSimulationPlaybackAndDerivedState()
    }

    function capitalizeFirstLetter(string: string) {
        return string.charAt(0).toUpperCase() + string.slice(1);
    }

    function copyChampionNames() {
        if (!metadata) return
        let championNames: string[] = []
        metadata.blueTeamMetadata.participantMetadata.forEach(participant => {
            championNames.push(participant.championId)
        })

        metadata.redTeamMetadata.participantMetadata.forEach(participant => {
            championNames.push(participant.championId)
        })
        navigator.clipboard.writeText(championNames.join("\t"));
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
        let vods = eventDetails.match.games[gameIndex ? gameIndex - 1 : 0].vods

        if (vods.length) {
            streamsOrVods = vods
        } else {
            if (!eventDetails.streams || !eventDetails.streams.length) {
                let streamGameIndex = gameIndex ? gameIndex - 1 : 0
                if (eventDetails.match.games[streamGameIndex] && eventDetails.match.games[streamGameIndex].state === "completed") {
                    return null
                } else {
                    eventDetails.streams = []
                }
            }
            streamsOrVods = eventDetails.streams.sort((a, b) => {
                if (!a.coStreamer && a.mediaLocale.locale.includes(`en-`)) {
                    if (a.provider === `youtube` && !b.coStreamer && b.mediaLocale.locale.includes(`en-`)) return 1
                    return -1
                }
                if (b.coStreamer) {
                    return b.offset - a.offset
                }
                return 1
            })
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

    const scheduleMatchResults = scheduleEvent?.match?.teams?.map((team) => team.result)
    const blueTeamOutcomeLabel = scheduleMatchResults?.[0]?.outcome ?? currentGameOutcome?.[0]?.outcome
    const redTeamOutcomeLabel = scheduleMatchResults?.[1]?.outcome ?? currentGameOutcome?.[1]?.outcome

    if (firstWindowFrame !== undefined && lastWindowFrame !== undefined && lastDetailsFrame !== undefined && metadata !== undefined && eventDetails !== undefined && currentGameOutcome !== undefined && scheduleEvent !== undefined && gameIndex !== undefined && items !== undefined && runes !== undefined) {
        return (
            <div className='match-container'>
                <MatchDetails eventDetails={eventDetails} gameMetadata={metadata} matchState={formatMatchState(eventDetails, lastWindowFrame, scheduleEvent)} records={records} results={results} scheduleEvent={scheduleEvent} />
                <Game eventDetails={eventDetails} gameIndex={gameIndex} gameMetadata={metadata} firstWindowFrame={firstWindowFrame} lastDetailsFrame={lastDetailsFrame} lastWindowFrame={lastWindowFrame} playbackTimestamp={playbackTimestamp} windowFrameTimeline={windowFrameTimeline} outcome={currentGameOutcome} records={records} results={results} items={items} runes={runes} championNameMap={championNameMap} backfillStatus={backfillStatus} inferredHeraldKillCounts={inferredHeraldKillCounts} inferredHeraldKillTimestampByTeam={inferredHeraldKillTimestampByTeam} objectiveTimerBackfillSeed={objectiveTimerBackfillSeed} debugSimulationModeEnabled={isDebugSimulationModeEnabled} debugSimulationRunning={isDebugSimulationRunning} debugShowAllDataEnabled={isDebugShowAllDataEnabled} onDebugSimulationModeChange={handleDebugSimulationModeChange} onDebugShowAllDataChange={handleDebugShowAllDataChange} onDebugSimulationToggle={handleDebugSimulationButtonClick} debugSimulationJumpMinutes={debugSimulationJumpMinuteOptions} onDebugSimulationJumpToMinute={handleDebugSimulationJumpToMinute} />
            </div>
        );
    } else if (firstWindowFrame !== undefined && metadata !== undefined && eventDetails !== undefined && scheduleEvent !== undefined && gameIndex !== undefined) {
        return (
            <div className='match-container'>
                <MatchDetails eventDetails={eventDetails} gameMetadata={metadata} matchState={formatMatchState(eventDetails, firstWindowFrame, scheduleEvent)} records={records} results={results} scheduleEvent={scheduleEvent} />
                <DisabledGame eventDetails={eventDetails} gameIndex={gameIndex} gameMetadata={metadata} firstWindowFrame={firstWindowFrame} records={records} championNameMap={championNameMap} inferredHeraldKillCounts={inferredHeraldKillCounts} debugSimulationModeEnabled={isDebugSimulationModeEnabled} debugSimulationRunning={isDebugSimulationRunning} debugShowAllDataEnabled={isDebugShowAllDataEnabled} onDebugSimulationModeChange={handleDebugSimulationModeChange} onDebugShowAllDataChange={handleDebugShowAllDataChange} onDebugSimulationToggle={handleDebugSimulationButtonClick} debugSimulationJumpMinutes={debugSimulationJumpMinuteOptions} onDebugSimulationJumpToMinute={handleDebugSimulationJumpToMinute} />
            </div>
        );
    } else if (eventDetails !== undefined) {
        document.title = `🟡 ${eventDetails.league.name} - ${eventDetails?.match.teams[0].name} vs. ${eventDetails?.match.teams[1].name}`;
        return (
            <div>
                <div className="loading-game-container">
                    <div>
                        {eventDetails ? (<h3>{eventDetails?.league.name}</h3>) : null}
                        <div className="live-game-card-content">
                            <div className="live-game-card-team">
                                {eventDetails.match.teams[0].code === "TBD" ? (<TeamTBDSVG className="live-game-card-team-image" />) : (<img className="live-game-card-team-image" src={eventDetails.match.teams[0].image} alt={eventDetails.match.teams[0].name} />)}
                                <span className="live-game-card-title">
                                    <span>
                                        <h4>
                                            {eventDetails?.match.teams[0].name}
                                        </h4>
                                    </span>
                                    {blueTeamOutcomeLabel ?
                                        (<span className="outcome">
                                            <p className={blueTeamOutcomeLabel}>
                                                {blueTeamOutcomeLabel}
                                            </p>
                                        </span>)
                                        : null}
                                    {records ?
                                        (<span>
                                            <p>
                                                {records[0].wins} - {records[0].losses}
                                            </p>
                                        </span>)
                                        : null}
                                </span>
                            </div>
                            <div className="game-card-versus">
                                <span>BEST OF {eventDetails.match.strategy.count}</span>
                                {eventDetails.match.teams[0].result && eventDetails.match.teams[1].result ?
                                    (<span>
                                        <p>
                                            {eventDetails.match.teams[0].result.gameWins} - {eventDetails.match.teams[1].result.gameWins}
                                        </p>
                                    </span>)
                                    : null}
                                <h1>VS</h1>
                            </div>
                            <div className="live-game-card-team">
                                {eventDetails.match.teams[1].code === "TBD" ? (<TeamTBDSVG className="live-game-card-team-image" />) : (<img className="live-game-card-team-image" src={eventDetails.match.teams[1].image} alt={eventDetails.match.teams[1].name} />)}
                                <span className="live-game-card-title">
                                    <span>
                                        <h4>
                                            {eventDetails?.match.teams[1].name}
                                        </h4>
                                    </span>
                                    {redTeamOutcomeLabel ?
                                        (<span className="outcome">
                                            <p className={redTeamOutcomeLabel}>
                                                {redTeamOutcomeLabel}
                                            </p>
                                        </span>)
                                        : null}
                                    {records ?
                                        (<span>
                                            <p>
                                                {records[1].wins} - {records[1].losses}
                                            </p>
                                        </span>)
                                        : null}
                                </span>
                            </div>
                        </div>
                        {scheduleEvent && eventDetails ?
                            (<h3>경기 시작 예정 : {new Date(scheduleEvent.startTime).toLocaleTimeString([], { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</h3>)
                            : null
                        }

                        <img className="loading-game-image" alt="game loading" src={Loading} />
                    </div>
                </div>
                <div className="status-live-game-card">
                    <GameDetails eventDetails={eventDetails} gameIndex={gameIndex || 0} />
                    <div className="status-live-game-card-content">
                        {metadata ? (
                            <div>
                                <span className="footer-notes">
                                    <a target="_blank" rel="noreferrer" href={`https://www.leagueoflegends.com/en-us/news/game-updates/patch-25-${metadata.patchVersion.split(`.`)[1].length > 1 ? metadata.patchVersion.split(`.`)[1] : "" + metadata.patchVersion.split(`.`)[1]}-notes/`}>Patch Version: {metadata.patchVersion}</a>
                                </span>
                                <span className="footer-notes">
                                    <button type="button" className="copy-champion-names" onClick={copyChampionNames}>
                                        Copy Champion Names
                                    </button>
                                </span>
                                <span className="footer-notes build-revision" title={`Build revision: ${BUILD_LABEL}`}>
                                    Revision: {BUILD_LABEL}
                                </span>
                            </div>
                        ) : null}
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
                </div>
                <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-4163525631983528" crossOrigin="anonymous"></script>
                <ins className="adsbygoogle"
                    data-ad-client="ca-pub-4163525631983528"
                    data-ad-slot="8779621455"
                    data-ad-format="auto"
                    data-full-width-responsive="true">
                </ins>
                <script>
                    (adsbygoogle = window.adsbygoogle || []).push({ });
                </script>
            </div>
        )
    } else {
        return (
            <div className="loading-game-container">
                <div>
                    <img className="loading-game-image" alt="game loading" src={Loading} />
                </div>
            </div>
        )
    }
}

function getNextUnstartedGameIndex(eventDetails: EventDetails) {
    let lastCompletedGame = eventDetails.match.games.slice().reverse().find(game => game.state === "completed")
    let nextUnstartedGame = eventDetails.match.games.find(game => game.state === "unstarted" || game.state === "inProgress")
    return nextUnstartedGame ? nextUnstartedGame.number : (lastCompletedGame ? lastCompletedGame.number : eventDetails.match.games.length)
}

function formatMatchState(eventDetails: EventDetails, lastWindowFrame: WindowFrame, scheduleEvent: ScheduleEvent): string {
    let gameStates = {
        "in_game": "진행 중",
        "paused": "일시정지",
        "finished": "종료",
        "completed": "종료",
        "unstarted": "예정",
        "inProgress": "진행 중",
        "unneeded": "미진행",
    }

    if (eventDetails.match.games.length === 1) return gameStates[lastWindowFrame.gameState]
    let gamesFinished = eventDetails.match.games.filter(game => game.state === `completed` || game.state === `unneeded`)
    return gameStates[gamesFinished.length >= eventDetails.match.games.length ? `completed` : scheduleEvent.state]
}

function getCurrentGameOutcomeFromRenderedWindowFrame(
    eventDetails: EventDetails,
    gameIndex: number,
    lastWindowFrame: WindowFrame,
): Array<Outcome> {
    const currentGame = eventDetails.match.games[gameIndex - 1]
    if (!currentGame) {
        return [{ outcome: undefined }, { outcome: undefined }]
    }

    const homeTeam = eventDetails.match.teams[0]
    const awayTeam = eventDetails.match.teams[1]
    const normalizedCurrentGameState = String(currentGame.state || ``).toLowerCase()
    const isCurrentGameStateCompleted = normalizedCurrentGameState === `completed`
    const isCurrentGameFinishedByWindow = lastWindowFrame.gameState === `finished`
    const isCurrentGameFinalized = isCurrentGameStateCompleted || isCurrentGameFinishedByWindow
    const cleanSweep =
        isCurrentGameStateCompleted
        && (
            eventDetails.match.teams[0].result.gameWins === 0
            || eventDetails.match.teams[1].result.gameWins === 0
        )

    const blueTeam = currentGame.teams[0].id === homeTeam.id ? homeTeam : awayTeam
    const redTeam = currentGame.teams[1].id === homeTeam.id ? homeTeam : awayTeam
    const blueTeamWonMatch =
        eventDetails.match.games.every((game) => game.state === `completed` || game.state === `unneeded`)
        && blueTeam.result.gameWins > redTeam.result.gameWins
    const redTeamWonMatch =
        eventDetails.match.games.every((game) => game.state === `completed` || game.state === `unneeded`)
        && redTeam.result.gameWins > blueTeam.result.gameWins
    const completedGameCount = eventDetails.match.games.filter((game) => game.state === `completed`).length
    const isCurrentGameCompletedByIndex = (gameIndex - 1) === completedGameCount

    const blueTeamWonOnInhibitors = lastWindowFrame.blueTeam.inhibitors > 0 && lastWindowFrame.redTeam.inhibitors === 0
    const redTeamWonOnInhibitors = lastWindowFrame.redTeam.inhibitors > 0 && lastWindowFrame.blueTeam.inhibitors === 0
    const winnerSideFromFrame = inferWinnerSideFromWindowFrame(lastWindowFrame)
    const blueTeamWonByFrame = winnerSideFromFrame === `blue`
    const redTeamWonByFrame = winnerSideFromFrame === `red`

    const blueTeamWon =
        isCurrentGameFinalized
        && (
            blueTeam.result.outcome === `win`
            || (cleanSweep && blueTeam.result.gameWins > 0)
            || blueTeamWonOnInhibitors
            || blueTeamWonByFrame
            || (blueTeamWonMatch && isCurrentGameCompletedByIndex)
        )
    const redTeamWon =
        isCurrentGameFinalized
        && (
            redTeam.result.outcome === `win`
            || (cleanSweep && redTeam.result.gameWins > 0)
            || redTeamWonOnInhibitors
            || redTeamWonByFrame
            || (redTeamWonMatch && isCurrentGameCompletedByIndex)
        )

    return [
        {
            outcome: blueTeamWon ? `win` : redTeamWon ? `loss` : undefined,
        },
        {
            outcome: redTeamWon ? `win` : blueTeamWon ? `loss` : undefined,
        },
    ]
}

function getPatchMajorMinorVersion(patchVersion: string) {
    const patchVersionParts = String(patchVersion || ``).split(`.`)
    if (patchVersionParts.length < 2) return undefined

    const majorPatchVersion = Number.parseInt(patchVersionParts[0], 10)
    const minorPatchVersion = Number.parseInt(patchVersionParts[1], 10)
    if (!Number.isFinite(majorPatchVersion) || !Number.isFinite(minorPatchVersion)) return undefined

    return `${majorPatchVersion}.${minorPatchVersion}`
}

async function getDataDragonRuneVersionCandidates(preferredVersion: string, patchMajorMinorVersion?: string) {
    const candidateVersions = [preferredVersion]

    try {
        const response = await getDataDragonVersionsResponse()
        const availableVersions = Array.isArray(response.data)
            ? response.data.filter((version) => typeof version === `string`)
            : []

        if (patchMajorMinorVersion) {
            const samePatchVersion = availableVersions.find((version) => version.startsWith(`${patchMajorMinorVersion}.`))
            if (samePatchVersion) {
                candidateVersions.push(samePatchVersion)
            }
        }

        if (availableVersions.length > 0) {
            candidateVersions.push(availableVersions[0])
        }
    } catch (error) {
        console.error(`Failed to fetch Data Dragon version list`, error)
    }

    return Array.from(new Set(candidateVersions.filter((version) => Boolean(version))))
}

function getRuneDataUrlCandidates(candidateVersions: string[]) {
    const locales = [`ko_KR`, `en_US`]
    const urlCandidates: Array<{ version: string, locale: string, jsonUrl: string }> = []

    candidateVersions.forEach((candidateVersion) => {
        locales.forEach((locale) => {
            const jsonUrl = RUNES_JSON_URL.replace(`/ko_KR/`, `/${locale}/`)
            urlCandidates.push({
                version: candidateVersion,
                locale,
                jsonUrl,
            })
        })
    })

    return urlCandidates
}

function stabilizeDetailsFrame(
    nextFrame: DetailsFrame,
    previousFrame?: DetailsFrame,
    observedItemsByParticipantId?: ObservedDetailsItemsByParticipantId,
    participantRoleByParticipantId?: ParticipantRoleByParticipantId,
    lastKnownBootByParticipantId?: LastKnownBootItemByParticipantId,
    isCompletedGame?: boolean,
    lastKnownTrinketByParticipantId?: LastKnownTrinketItemByParticipantId,
    lastRawTrinketByParticipantId?: LastRawTrinketItemByParticipantId,
    elapsedGameTimeMs?: number,
    inferredHeraldByTeam?: InferredHeraldByTeam,
    pendingHeraldTrinketDropCountByParticipantId?: PendingHeraldTrinketDropCountByParticipantId,
    hasObservedRawTrinketByParticipantId?: HasObservedRawTrinketByParticipantId,
    magicalFootwearTiming: MagicalFootwearTiming = DEFAULT_MAGICAL_FOOTWEAR_TIMING,
): DetailsFrame {
    const previousItemsByParticipantId = new Map<number, number[]>()
    if (previousFrame) {
        previousFrame.participants.forEach((participant) => {
            previousItemsByParticipantId.set(participant.participantId, sanitizeItemIds(participant.items))
        })
    }

    const participants = nextFrame.participants.map((participant) => {
        const currentItems = sanitizeItemIds(participant.items)
        const previousItems = previousItemsByParticipantId.get(participant.participantId) || []
        const participantRole = participantRoleByParticipantId?.get(participant.participantId)
        const lastKnownBootItemId = lastKnownBootByParticipantId?.get(participant.participantId)
        const lastKnownTrinketItemId = lastKnownTrinketByParticipantId?.get(participant.participantId)
        const previousRawTrinketItemId = lastRawTrinketByParticipantId?.get(participant.participantId)
        const currentRawTrinketItemId = getTrinketItemId(currentItems)
        const hadObservedRawTrinketBeforeFrame = hasObservedRawTrinketByParticipantId?.get(participant.participantId) === true
        const observedItems = getObservedItemsForParticipant(observedItemsByParticipantId, participant.participantId)
        recordObservedItems(observedItems, previousItems)
        recordObservedItems(observedItems, currentItems)
        if (currentRawTrinketItemId !== undefined && hasObservedRawTrinketByParticipantId) {
            hasObservedRawTrinketByParticipantId.set(participant.participantId, true)
        }

        let stabilizedItems = currentItems
        if (currentItems.length === 0 && previousItems.length > 0) {
            stabilizedItems = previousItems
        }
        else if (shouldKeepPreviousOnSuspiciousDrop(currentItems, previousItems)) {
            stabilizedItems = previousItems
        }
        else {
            const droppedItemsCount = previousItems.length - currentItems.length
            if (
                droppedItemsCount >= 2
                && currentItems.length > 0
                && isSubsetWithCounts(currentItems, previousItems)
            ) {
                // Partial payloads sometimes drop 1-2 item slots. Keep last known-good snapshot.
                stabilizedItems = previousItems
            }
        }

        const midBootRestoredItems = restoreMidBootOnUnexpectedMissingSlot(
            stabilizedItems,
            previousItems,
            participant,
            participantRole,
            lastKnownBootItemId,
            observedItems,
            isCompletedGame,
        )
        const bootRestoredItems = restoreBottomBootOnUnexpectedMissingSlot(
            midBootRestoredItems,
            previousItems,
            participantRole,
            lastKnownBootItemId,
        )
        const inferredItems = applyAggressiveMissingItemInference(
            bootRestoredItems,
            previousItems,
            participant,
            observedItems,
            participantRole,
            lastKnownBootItemId,
            isCompletedGame,
        )
        const normalizedBootRegressionItems = normalizeSuspiciousBootRegression(inferredItems, previousItems, lastKnownBootItemId)
        const dedupedBootItems = normalizeUnexpectedDuplicateBootItems(normalizedBootRegressionItems, previousItems, lastKnownBootItemId, observedItems)
        const magicalFootwearRecoveredItems = inferMagicalFootwearOnUnlock(
            dedupedBootItems,
            participant,
            elapsedGameTimeMs,
            magicalFootwearTiming,
        )
        const magicalFootwearNormalizedItems = removeInjectedMagicalFootwearWhenUpgraded(magicalFootwearRecoveredItems)
        const normalizedTearItems = normalizeLikelyStaleTearBaseItem(magicalFootwearNormalizedItems, previousItems, participant, observedItems)
        const armguardRecoveredItems = inferShatteredArmguardFromUsedSeeker(normalizedTearItems, previousItems)
        const armguardNormalizedItems = removeShatteredArmguardWhenZhonyaOwned(armguardRecoveredItems)
        const trinketRestoreResult = restoreMissingTrinketOnUnexpectedMissingSlot(
            armguardNormalizedItems,
            previousItems,
            observedItems,
            lastKnownTrinketItemId,
            elapsedGameTimeMs,
            participantRole,
            participant.participantId,
            pendingHeraldTrinketDropCountByParticipantId || new Map(),
            hadObservedRawTrinketBeforeFrame,
            previousRawTrinketItemId,
            currentRawTrinketItemId,
        )
        const trinketRestoredItems = trinketRestoreResult.itemIds
        if (inferredHeraldByTeam && trinketRestoreResult.inferredHeraldCapture) {
            const inferredTeamColor = participant.participantId <= 5 ? `blue` : `red`
            const oppositeTeamColor = inferredTeamColor === `blue` ? `red` : `blue`
            if (!inferredHeraldByTeam[inferredTeamColor] && !inferredHeraldByTeam[oppositeTeamColor]) {
                inferredHeraldByTeam[inferredTeamColor] = true
            }
        }

        const currentBootItemId = getBootItemId(trinketRestoredItems)
        const resolvedKnownBootItemId = resolveKnownBootItemId(currentBootItemId, lastKnownBootItemId)
        const shouldStoreResolvedBoot =
            resolvedKnownBootItemId !== undefined
            && !(isCompletedGame && resolvedKnownBootItemId === 1001 && lastKnownBootItemId === undefined)
        if (lastKnownBootByParticipantId && shouldStoreResolvedBoot) {
            lastKnownBootByParticipantId.set(participant.participantId, resolvedKnownBootItemId)
        }

        const currentTrinketItemId = getTrinketItemId(trinketRestoredItems)
        if (lastKnownTrinketByParticipantId && currentTrinketItemId !== undefined) {
            lastKnownTrinketByParticipantId.set(participant.participantId, currentTrinketItemId)
        }
        if (lastRawTrinketByParticipantId) {
            if (currentRawTrinketItemId !== undefined) {
                lastRawTrinketByParticipantId.set(participant.participantId, currentRawTrinketItemId)
            } else {
                lastRawTrinketByParticipantId.delete(participant.participantId)
            }
        }

        return { ...participant, items: trinketRestoredItems }
    })

    return {
        ...nextFrame,
        participants,
    }
}

function sanitizeItemIds(itemIds: number[] | undefined) {
    if (!Array.isArray(itemIds)) return []
    return itemIds.filter((itemId) => Number.isFinite(itemId) && itemId > 0)
}

function getMagicalFootwearTimingFromRunes(runes: Rune[] | undefined): MagicalFootwearTiming {
    if (!Array.isArray(runes) || runes.length === 0) return DEFAULT_MAGICAL_FOOTWEAR_TIMING

    const magicalFootwearRune = getAllSlottedRunes(runes).find((slottedRune) => slottedRune.id === MAGICAL_FOOTWEAR_RUNE_ID)
    if (!magicalFootwearRune?.longDesc) return DEFAULT_MAGICAL_FOOTWEAR_TIMING

    const normalizedLongDescription = stripHtmlTags(magicalFootwearRune.longDesc).replace(/&nbsp;/gi, ` `)
    const minuteMatch = normalizedLongDescription.match(/(\d+)\s*(?:min|minutes?|분)/i)
    const secondMatch = normalizedLongDescription.match(/(\d+)\s*(?:s|sec|seconds?|초)/i)

    const parsedUnlockAfterMinutes = Number(minuteMatch?.[1])
    const parsedTakedownReductionSeconds = Number(secondMatch?.[1])

    return {
        unlockAfterMs: Number.isFinite(parsedUnlockAfterMinutes) && parsedUnlockAfterMinutes > 0
            ? parsedUnlockAfterMinutes * 60 * 1000
            : DEFAULT_MAGICAL_FOOTWEAR_TIMING.unlockAfterMs,
        takedownReductionMs: Number.isFinite(parsedTakedownReductionSeconds) && parsedTakedownReductionSeconds > 0
            ? parsedTakedownReductionSeconds * 1000
            : DEFAULT_MAGICAL_FOOTWEAR_TIMING.takedownReductionMs,
    }
}

function getAllSlottedRunes(runes: Rune[]) {
    return runes.flatMap((rune) => rune.slots.flatMap((slot) => slot.runes))
}

function stripHtmlTags(text: string) {
    return text.replace(/<[^>]*>/g, ` `)
}

const TRINKET_ITEM_IDS = [3330, 3340, 3348, 3349, 3363, 3364, 6702]
const TRINKET_ITEM_PREFERENCE_ORDER = [3364, 3363, 3340, 3330, 3348, 3349, 6702]
const CONSUMABLE_ITEM_IDS = [2003, 2010, 2031, 2033, 2055]
const MAX_INVENTORY_ITEM_SLOTS = 8

type MissingItemInferencePair = {
    sourceItemId: number,
    targetItemId: number,
    type: `transform` | `boots`,
}

type TearLineUpgradeInferenceBranch = {
    sourceItemId: number,
    targetItemId: number,
    profile: `ap` | `ad` | `tank`,
    componentHintItemIds: number[],
    subComponentHintItemIds: number[],
    highConfidenceComponentHintItemIds: number[],
    highConfidenceSubComponentHintItemIds: number[],
}

const AGGRESSIVE_MISSING_ITEM_INFERENCE_PAIRS: MissingItemInferencePair[] = [
    { sourceItemId: 3003, targetItemId: 3040, type: `transform` }, // Archangel's Staff -> Seraph's Embrace
    { sourceItemId: 3004, targetItemId: 3042, type: `transform` }, // Manamune -> Muramana
    { sourceItemId: 3119, targetItemId: 3121, type: `transform` }, // Winter's Approach -> Fimbulwinter
    { sourceItemId: 2526, targetItemId: 2530, type: `transform` }, // Whispering Circlet -> Diadem of Songs
    { sourceItemId: 3009, targetItemId: 3170, type: `boots` }, // Boots of Swiftness -> Swiftmarch
    { sourceItemId: 3158, targetItemId: 3171, type: `boots` }, // Ionian Boots -> Crimson Lucidity
    { sourceItemId: 3006, targetItemId: 3172, type: `boots` }, // Berserker's Greaves -> Gunmetal Greaves
    { sourceItemId: 3111, targetItemId: 3173, type: `boots` }, // Mercury's Treads -> Chainlaced Crushers
    { sourceItemId: 3047, targetItemId: 3174, type: `boots` }, // Plated Steelcaps -> Armored Advance
    { sourceItemId: 3020, targetItemId: 3175, type: `boots` }, // Sorcerer's Shoes -> Spellslinger's Shoes
    { sourceItemId: 3008, targetItemId: 3168, type: `boots` }, // additional boot upgrade chain
    { sourceItemId: 3010, targetItemId: 3013, type: `boots` }, // Symbiotic Soles -> Synchronized Souls
    { sourceItemId: 3013, targetItemId: 3176, type: `boots` }, // Synchronized Souls -> Forever Forward
]
const BOOT_UPGRADE_TARGET_BY_SOURCE_ITEM_ID = new Map<number, number>(
    AGGRESSIVE_MISSING_ITEM_INFERENCE_PAIRS
        .filter((inferencePair) => inferencePair.type === `boots`)
        .map((inferencePair) => [inferencePair.sourceItemId, inferencePair.targetItemId])
)
const BOOT_SOURCE_ITEM_ID_BY_TARGET_ITEM_ID = new Map<number, number>(
    AGGRESSIVE_MISSING_ITEM_INFERENCE_PAIRS
        .filter((inferencePair) => inferencePair.type === `boots`)
        .map((inferencePair) => [inferencePair.targetItemId, inferencePair.sourceItemId])
)
const BASE_AND_UPGRADED_BOOT_ITEM_IDS = [
    1001,
    SLIGHTLY_MAGICAL_FOOTWEAR_ITEM_ID,
    3005,
    3006,
    3008,
    3009,
    3010,
    3013,
    3020,
    3047,
    3111,
    3117,
    3158,
    3168,
    3170,
    3171,
    3172,
    3173,
    3174,
    3175,
    3176,
]
const BOOT_ITEM_PREFERENCE_ORDER = BASE_AND_UPGRADED_BOOT_ITEM_IDS.slice().reverse()
const TIER3_BOOT_ITEM_IDS = [3168, 3170, 3171, 3172, 3173, 3174, 3175, 3176]
const TIER2_BOOT_ITEM_IDS = BASE_AND_UPGRADED_BOOT_ITEM_IDS.filter((itemId) =>
    itemId !== 1001
    && itemId !== SLIGHTLY_MAGICAL_FOOTWEAR_ITEM_ID
    && !TIER3_BOOT_ITEM_IDS.includes(itemId)
)
const TEAR_OF_THE_GODDESS_ITEM_ID = 3070
const TEAR_LINE_UPGRADE_INFERENCE_BRANCHES: TearLineUpgradeInferenceBranch[] = [
    {
        sourceItemId: 3003, // Archangel's Staff
        targetItemId: 3040, // Seraph's Embrace
        profile: `ap`,
        componentHintItemIds: [1058, 3108, 3802, 3803, 2522],
        subComponentHintItemIds: [1026, 1027, 1052],
        highConfidenceComponentHintItemIds: [3108, 3802, 3803, 2522],
        highConfidenceSubComponentHintItemIds: [1027],
    },
    {
        sourceItemId: 3004, // Manamune
        targetItemId: 3042, // Muramana
        profile: `ad`,
        componentHintItemIds: [1037, 3133],
        subComponentHintItemIds: [1036],
        highConfidenceComponentHintItemIds: [3133],
        highConfidenceSubComponentHintItemIds: [1036],
    },
    {
        sourceItemId: 3119, // Winter's Approach
        targetItemId: 3121, // Fimbulwinter
        profile: `tank`,
        componentHintItemIds: [1011, 3067],
        // Ruby Crystal (1028) is too cross-build noisy for tear-line disambiguation.
        subComponentHintItemIds: [1027],
        highConfidenceComponentHintItemIds: [1011, 3067],
        highConfidenceSubComponentHintItemIds: [],
    },
    {
        sourceItemId: 2526, // Whispering Circlet
        targetItemId: 2530, // Diadem of Songs
        profile: `ap`,
        // Diadem line is support-skewed. Include support quest items as soft hints.
        componentHintItemIds: [3114, 3865, 3866, 3867, 3869, 3870, 3871, 3876, 3877],
        subComponentHintItemIds: [1004],
        highConfidenceComponentHintItemIds: [3114, 3869, 3870, 3871, 3876, 3877],
        highConfidenceSubComponentHintItemIds: [1004],
    },
]
const TEAR_LINE_SOURCE_AND_TARGET_ITEM_IDS = TEAR_LINE_UPGRADE_INFERENCE_BRANCHES.reduce<number[]>((itemIds, branch) => {
    itemIds.push(branch.sourceItemId, branch.targetItemId)
    return itemIds
}, [])
const EARLY_STALE_TEAR_INVENTORY_ITEM_COUNT_THRESHOLD = 4
const SEEKER_ARMGUARD_ITEM_ID = 2420
const SHATTERED_ARMGUARD_ITEM_ID = 2421
const ZHONYAS_HOURGLASS_ITEM_ID = 3157

function getObservedItemsForParticipant(observedItemsByParticipantId: ObservedDetailsItemsByParticipantId | undefined, participantId: number) {
    if (!observedItemsByParticipantId) return undefined
    const existingObservedItems = observedItemsByParticipantId.get(participantId)
    if (existingObservedItems) return existingObservedItems
    const newObservedItems = new Set<number>()
    observedItemsByParticipantId.set(participantId, newObservedItems)
    return newObservedItems
}

function recordObservedItems(observedItems: Set<number> | undefined, itemIds: number[]) {
    if (!observedItems) return
    itemIds.forEach((itemId) => {
        observedItems.add(itemId)
    })
}

function applyAggressiveMissingItemInference(
    itemIds: number[],
    previousItemIds: number[],
    participant: DetailsFrame[`participants`][number],
    observedItems: Set<number> | undefined,
    participantRole: string | undefined,
    lastKnownBootItemId: number | undefined,
    isCompletedGame?: boolean,
) {
    if (!observedItems || itemIds.length === 0) return itemIds

    let inferredItems = itemIds.slice()
    AGGRESSIVE_MISSING_ITEM_INFERENCE_PAIRS.forEach((inferencePair) => {
        if (inferencePair.type === `boots` && !isMidRole(participantRole)) return
        if (inferencePair.type === `boots`) {
            const knownBootItemId =
                resolveKnownBootItemId(getBootItemId(previousItemIds), lastKnownBootItemId)
                || getStableObservedBootItemId(observedItems)
            if (isCompletedGame && knownBootItemId === 1001 && lastKnownBootItemId === undefined && getBootItemId(previousItemIds) === undefined) return
            if (knownBootItemId === undefined) return
            if (!isBootInferencePairAllowedByKnownBoot(inferencePair, knownBootItemId)) return
        }

        const sourceWasObserved = observedItems.has(inferencePair.sourceItemId)
        const targetWasObserved = observedItems.has(inferencePair.targetItemId)
        if (!sourceWasObserved || targetWasObserved) return

        if (!canAggressivelyInferMissingItem(inferencePair, inferredItems, previousItemIds, participant)) return

        if (inferredItems.includes(inferencePair.targetItemId)) {
            return
        }

        const sourceItemIndex = inferredItems.findIndex((itemId) => itemId === inferencePair.sourceItemId)
        if (sourceItemIndex >= 0) {
            inferredItems = replaceItemAtIndex(inferredItems, sourceItemIndex, inferencePair.targetItemId)
            return
        }

        inferredItems = appendOrReplaceInferredItem(inferredItems, inferencePair.targetItemId)
    })

    inferredItems = inferTearLineUpgradeFromComponentDrop(
        inferredItems,
        previousItemIds,
        participant,
        observedItems,
    )
    inferredItems = inferTearLineUpgradeFromObservedHistory(
        inferredItems,
        participant,
        observedItems,
        participantRole,
    )

    return inferredItems
}

function inferTearLineUpgradeFromComponentDrop(
    currentItemIds: number[],
    previousItemIds: number[],
    participant: DetailsFrame[`participants`][number],
    observedItems: Set<number>,
) {
    if (currentItemIds.some((itemId) => TEAR_LINE_SOURCE_AND_TARGET_ITEM_IDS.includes(itemId))) return currentItemIds

    const droppedItemIds = getDroppedItemIds(previousItemIds, currentItemIds)
    if (!droppedItemIds.includes(TEAR_OF_THE_GODDESS_ITEM_ID)) return currentItemIds

    const candidateBranches = TEAR_LINE_UPGRADE_INFERENCE_BRANCHES.filter((branch) =>
        shouldConsiderTearLineBranchFromDrop(branch, droppedItemIds, observedItems, participant)
    )
    if (candidateBranches.length === 0) return currentItemIds

    const selectedBranch = selectTearLineUpgradeInferenceBranch(candidateBranches, droppedItemIds, observedItems, participant)
    if (!selectedBranch) return currentItemIds

    const targetItemId = getPreferredTearLineRecoveredItemId(selectedBranch, participant, observedItems, currentItemIds)
    if (targetItemId === undefined) return currentItemIds
    return appendOrReplaceInferredItem(currentItemIds, targetItemId)
}

function inferTearLineUpgradeFromObservedHistory(
    currentItemIds: number[],
    participant: DetailsFrame[`participants`][number],
    observedItems: Set<number>,
    participantRole: string | undefined,
) {
    if (!observedItems.has(TEAR_OF_THE_GODDESS_ITEM_ID)) return currentItemIds
    if (currentItemIds.some((itemId) => TEAR_LINE_SOURCE_AND_TARGET_ITEM_IDS.includes(itemId))) return currentItemIds

    const candidateBranches = TEAR_LINE_UPGRADE_INFERENCE_BRANCHES.filter((branch) =>
        shouldConsiderTearLineBranchFromObservedHistory(branch, currentItemIds, observedItems, participant, participantRole)
    )
    if (candidateBranches.length === 0) return currentItemIds

    const selectedBranch = selectTearLineUpgradeInferenceBranchFromObservedHistory(candidateBranches, observedItems, participant)
    if (!selectedBranch) return currentItemIds

    const targetItemId = getPreferredTearLineRecoveredItemId(selectedBranch, participant, observedItems, currentItemIds)
    if (targetItemId === undefined) return currentItemIds
    return appendOrReplaceInferredItem(currentItemIds, targetItemId)
}

function shouldConsiderTearLineBranchFromDrop(
    branch: TearLineUpgradeInferenceBranch,
    droppedItemIds: number[],
    observedItems: Set<number>,
    participant: DetailsFrame[`participants`][number],
) {
    const branchWasObserved = observedItems.has(branch.sourceItemId) || observedItems.has(branch.targetItemId)
    if (branchWasObserved) return true

    const droppedComponentHintCount = countMatchedItemIds(droppedItemIds, branch.componentHintItemIds)
    const droppedSubComponentHintCount = countMatchedItemIds(droppedItemIds, branch.subComponentHintItemIds)
    if (droppedComponentHintCount === 0 && droppedSubComponentHintCount === 0) return false

    const droppedHighConfidenceHintCount =
        countMatchedItemIds(droppedItemIds, branch.highConfidenceComponentHintItemIds)
        + countMatchedItemIds(droppedItemIds, branch.highConfidenceSubComponentHintItemIds)
    if (droppedHighConfidenceHintCount > 0) return true
    if (droppedComponentHintCount > 0 && droppedSubComponentHintCount > 0) return true

    const profile = getParticipantTearLineProfile(participant)
    return profile === branch.profile
}

function selectTearLineUpgradeInferenceBranch(
    candidateBranches: TearLineUpgradeInferenceBranch[],
    droppedItemIds: number[],
    observedItems: Set<number>,
    participant: DetailsFrame[`participants`][number],
) {
    const profile = getParticipantTearLineProfile(participant)
    const rankedBranches = candidateBranches
        .map((branch) => {
            const highConfidenceComponentHintCount = countMatchedItemIds(droppedItemIds, branch.highConfidenceComponentHintItemIds)
            const highConfidenceSubComponentHintCount = countMatchedItemIds(droppedItemIds, branch.highConfidenceSubComponentHintItemIds)
            const componentHintCount = countMatchedItemIds(droppedItemIds, branch.componentHintItemIds)
            const subComponentHintCount = countMatchedItemIds(droppedItemIds, branch.subComponentHintItemIds)
            const observedTargetScore = observedItems.has(branch.targetItemId) ? 1 : 0
            const observedSourceScore = observedItems.has(branch.sourceItemId) ? 1 : 0
            const profileScore = branch.profile === profile ? 1 : 0
            return {
                branch,
                highConfidenceHintCount: highConfidenceComponentHintCount + highConfidenceSubComponentHintCount,
                componentHintCount,
                subComponentHintCount,
                totalHintCount: componentHintCount + subComponentHintCount,
                observedTargetScore,
                observedSourceScore,
                profileScore,
            }
        })
        .sort((left, right) => {
            if (right.observedTargetScore !== left.observedTargetScore) return right.observedTargetScore - left.observedTargetScore
            if (right.observedSourceScore !== left.observedSourceScore) return right.observedSourceScore - left.observedSourceScore
            if (right.highConfidenceHintCount !== left.highConfidenceHintCount) return right.highConfidenceHintCount - left.highConfidenceHintCount
            if (right.componentHintCount !== left.componentHintCount) return right.componentHintCount - left.componentHintCount
            if (right.subComponentHintCount !== left.subComponentHintCount) return right.subComponentHintCount - left.subComponentHintCount
            if (right.totalHintCount !== left.totalHintCount) return right.totalHintCount - left.totalHintCount
            if (right.profileScore !== left.profileScore) return right.profileScore - left.profileScore
            return 0
        })

    return rankedBranches[0]?.branch
}

function shouldConsiderTearLineBranchFromObservedHistory(
    branch: TearLineUpgradeInferenceBranch,
    currentItemIds: number[],
    observedItems: Set<number>,
    participant: DetailsFrame[`participants`][number],
    participantRole: string | undefined,
) {
    const branchWasObserved = observedItems.has(branch.sourceItemId) || observedItems.has(branch.targetItemId)

    const observedComponentHintCount = countMatchedObservedItemIds(observedItems, branch.componentHintItemIds)
    const observedSubComponentHintCount = countMatchedObservedItemIds(observedItems, branch.subComponentHintItemIds)
    if (!branchWasObserved && observedComponentHintCount === 0 && observedSubComponentHintCount === 0) return false

    const observedHighConfidenceHintCount =
        countMatchedObservedItemIds(observedItems, branch.highConfidenceComponentHintItemIds)
        + countMatchedObservedItemIds(observedItems, branch.highConfidenceSubComponentHintItemIds)
    const hasCurrentBranchEvidence = hasCurrentTearBranchEvidence(currentItemIds, branch)
    const isSupportRole = participantRole?.toLowerCase() === `support`
    const profile = getParticipantTearLineProfile(participant)
    const profileMatches = profile === branch.profile

    if (branchWasObserved) return true

    // Tank branch on support creates frequent false positives from shared HP components.
    // Require live-frame branch evidence before inferring from history-only hints.
    if (branch.profile === `tank` && isSupportRole && !hasCurrentBranchEvidence) return false

    if (observedHighConfidenceHintCount >= 2 && (profileMatches || hasCurrentBranchEvidence)) return true
    if (observedHighConfidenceHintCount >= 1 && profileMatches && hasCurrentBranchEvidence) return true
    if (observedComponentHintCount > 0 && observedSubComponentHintCount > 0 && profileMatches && hasCurrentBranchEvidence) return true
    return profileMatches && hasCurrentBranchEvidence
}

function selectTearLineUpgradeInferenceBranchFromObservedHistory(
    candidateBranches: TearLineUpgradeInferenceBranch[],
    observedItems: Set<number>,
    participant: DetailsFrame[`participants`][number],
) {
    const profile = getParticipantTearLineProfile(participant)
    const rankedBranches = candidateBranches
        .map((branch) => {
            const highConfidenceComponentHintCount = countMatchedObservedItemIds(observedItems, branch.highConfidenceComponentHintItemIds)
            const highConfidenceSubComponentHintCount = countMatchedObservedItemIds(observedItems, branch.highConfidenceSubComponentHintItemIds)
            const componentHintCount = countMatchedObservedItemIds(observedItems, branch.componentHintItemIds)
            const subComponentHintCount = countMatchedObservedItemIds(observedItems, branch.subComponentHintItemIds)
            const observedTargetScore = observedItems.has(branch.targetItemId) ? 1 : 0
            const observedSourceScore = observedItems.has(branch.sourceItemId) ? 1 : 0
            const profileScore = branch.profile === profile ? 1 : 0
            return {
                branch,
                highConfidenceHintCount: highConfidenceComponentHintCount + highConfidenceSubComponentHintCount,
                componentHintCount,
                subComponentHintCount,
                totalHintCount: componentHintCount + subComponentHintCount,
                observedTargetScore,
                observedSourceScore,
                profileScore,
            }
        })
        .sort((left, right) => {
            if (right.observedTargetScore !== left.observedTargetScore) return right.observedTargetScore - left.observedTargetScore
            if (right.observedSourceScore !== left.observedSourceScore) return right.observedSourceScore - left.observedSourceScore
            if (right.highConfidenceHintCount !== left.highConfidenceHintCount) return right.highConfidenceHintCount - left.highConfidenceHintCount
            if (right.componentHintCount !== left.componentHintCount) return right.componentHintCount - left.componentHintCount
            if (right.subComponentHintCount !== left.subComponentHintCount) return right.subComponentHintCount - left.subComponentHintCount
            if (right.totalHintCount !== left.totalHintCount) return right.totalHintCount - left.totalHintCount
            if (right.profileScore !== left.profileScore) return right.profileScore - left.profileScore
            return 0
        })

    return rankedBranches[0]?.branch
}

function getParticipantTearLineProfile(participant: DetailsFrame[`participants`][number]) {
    if (participant.abilityPower >= participant.attackDamage + 25) return `ap`
    if (participant.attackDamage >= participant.abilityPower + 20) return `ad`
    return `tank`
}

function getPreferredTearLineRecoveredItemId(
    branch: TearLineUpgradeInferenceBranch,
    participant: DetailsFrame[`participants`][number],
    observedItems: Set<number>,
    currentItemIds: number[],
) {
    const hasCurrentTear = currentItemIds.includes(TEAR_OF_THE_GODDESS_ITEM_ID)
    const sourceWasObserved = observedItems.has(branch.sourceItemId)
    const targetWasObserved = observedItems.has(branch.targetItemId)
    if (hasCurrentTear && !sourceWasObserved && !targetWasObserved) {
        // Prevent speculative tear-line recovery while Tear is still explicitly
        // present in the current inventory payload and no concrete branch state
        // has been observed yet.
        return undefined
    }

    if (targetWasObserved) return branch.targetItemId
    if (sourceWasObserved) return branch.sourceItemId

    const canAssumeTransformedItem = participant.level >= 14 || participant.totalGoldEarned >= 10500
    return canAssumeTransformedItem ? branch.targetItemId : branch.sourceItemId
}

function countMatchedItemIds(referenceItemIds: number[], targetItemIds: number[]) {
    if (referenceItemIds.length === 0 || targetItemIds.length === 0) return 0
    return referenceItemIds.filter((itemId) => targetItemIds.includes(itemId)).length
}

function countMatchedObservedItemIds(observedItems: Set<number>, targetItemIds: number[]) {
    if (observedItems.size === 0 || targetItemIds.length === 0) return 0
    let count = 0
    targetItemIds.forEach((itemId) => {
        if (observedItems.has(itemId)) count++
    })
    return count
}

function restoreMidBootOnUnexpectedMissingSlot(
    itemIds: number[],
    previousItemIds: number[],
    participant: DetailsFrame[`participants`][number],
    participantRole: string | undefined,
    lastKnownBootItemId: number | undefined,
    observedItems: Set<number> | undefined,
    isCompletedGame?: boolean,
) {
    if (!isMidRole(participantRole)) return itemIds
    if (getBootItemId(itemIds) !== undefined) return itemIds

    const previousBootItemId = getBootItemId(previousItemIds)
    const knownBootItemId = resolveKnownBootItemId(previousBootItemId, lastKnownBootItemId)
    const observedBootItemId = getStableObservedBootItemId(observedItems, knownBootItemId)
    if (isCompletedGame && knownBootItemId === undefined && observedBootItemId === 1001) return itemIds
    const fallbackBootItemId = selectPreferredMidFallbackBootItemId(knownBootItemId, observedBootItemId)
    if (fallbackBootItemId === undefined) return itemIds

    const inferredTier3FromTier2Drop = inferMidTier3BootFromMissingTier2(
        itemIds,
        observedItems,
    )
    if (inferredTier3FromTier2Drop) return inferredTier3FromTier2Drop

    const preferredBootItemId = getPreferredMidRecoveredBootItemId(fallbackBootItemId, observedItems)
    return appendOrReplaceInferredItem(itemIds, preferredBootItemId)
}

function restoreBottomBootOnUnexpectedMissingSlot(
    itemIds: number[],
    previousItemIds: number[],
    participantRole: string | undefined,
    lastKnownBootItemId: number | undefined,
) {
    if (!isBottomRole(participantRole)) return itemIds
    if (getBootItemId(itemIds) !== undefined) return itemIds

    const previousBootItemId = getBootItemId(previousItemIds)
    if (previousBootItemId === undefined) return itemIds
    if (!isBottomRecoverableBootItemId(previousBootItemId)) return itemIds

    const knownBootItemId = resolveKnownBootItemId(previousBootItemId, lastKnownBootItemId)
    const fallbackBootItemId = selectPreferredBottomFallbackBootItemId(previousBootItemId, knownBootItemId)
    if (fallbackBootItemId === undefined) return itemIds
    if (!isBottomRecoverableBootItemId(fallbackBootItemId)) return itemIds

    return appendOrReplaceInferredItem(itemIds, fallbackBootItemId)
}

function inferMidTier3BootFromMissingTier2(
    currentItemIds: number[],
    observedItems: Set<number> | undefined,
) {
    const observedTier2BootItemId = getObservedTier2BootItemId(observedItems)
    if (observedTier2BootItemId === undefined) return undefined

    // If six non-boot equipment slots are already filled, this may be an intentional boot sell.
    if (getNonBootEquipmentItemIds(currentItemIds).length === 6) return undefined

    const upgradedTier3BootItemId = getTerminalTier3BootUpgradeItemId(observedTier2BootItemId)
    if (upgradedTier3BootItemId === undefined) return undefined
    return appendOrReplaceInferredItem(currentItemIds, upgradedTier3BootItemId)
}

function getObservedTier2BootItemId(observedItems: Set<number> | undefined) {
    if (!observedItems || observedItems.size === 0) return undefined
    return BOOT_ITEM_PREFERENCE_ORDER.find((itemId) =>
        TIER2_BOOT_ITEM_IDS.includes(itemId) && observedItems.has(itemId)
    )
}

function getBootItemId(itemIds: number[]) {
    return BOOT_ITEM_PREFERENCE_ORDER.find((itemId) => itemIds.includes(itemId))
}

function getTrinketItemId(itemIds: number[]) {
    return TRINKET_ITEM_PREFERENCE_ORDER.find((itemId) => itemIds.includes(itemId))
}

function inferMagicalFootwearOnUnlock(
    itemIds: number[],
    participant: DetailsFrame[`participants`][number],
    elapsedGameTimeMs: number | undefined,
    magicalFootwearTiming: MagicalFootwearTiming,
) {
    const hasMagicalFootwearRune = participant.perkMetadata?.perks?.includes(MAGICAL_FOOTWEAR_RUNE_ID)
    if (!hasMagicalFootwearRune) return itemIds
    if (!Number.isFinite(elapsedGameTimeMs)) return itemIds
    if (itemIds.includes(SLIGHTLY_MAGICAL_FOOTWEAR_ITEM_ID)) return itemIds
    if (hasTier2OrTier3Boot(itemIds)) return itemIds
    if (getBootItemId(itemIds) !== undefined) return itemIds

    const takedownCount = Math.max(0, participant.kills + participant.assists)
    const unlockAfterMs = Math.max(0, magicalFootwearTiming.unlockAfterMs - takedownCount * magicalFootwearTiming.takedownReductionMs)
    if (Number(elapsedGameTimeMs) < unlockAfterMs) return itemIds

    return appendInferredItemIfSlotAvailable(itemIds, SLIGHTLY_MAGICAL_FOOTWEAR_ITEM_ID)
}

function hasTier2OrTier3Boot(itemIds: number[]) {
    return itemIds.some((itemId) => TIER2_BOOT_ITEM_IDS.includes(itemId) || TIER3_BOOT_ITEM_IDS.includes(itemId))
}

function removeInjectedMagicalFootwearWhenUpgraded(itemIds: number[]) {
    if (!itemIds.includes(SLIGHTLY_MAGICAL_FOOTWEAR_ITEM_ID)) return itemIds
    if (!hasTier2OrTier3Boot(itemIds)) return itemIds
    return itemIds.filter((itemId) => itemId !== SLIGHTLY_MAGICAL_FOOTWEAR_ITEM_ID)
}

type TrinketRestoreResult = {
    itemIds: number[],
    inferredHeraldCapture: boolean,
}

function restoreMissingTrinketOnUnexpectedMissingSlot(
    itemIds: number[],
    previousItemIds: number[],
    observedItems: Set<number> | undefined,
    lastKnownTrinketItemId: number | undefined,
    elapsedGameTimeMs: number | undefined,
    _participantRole: string | undefined,
    participantId: number,
    pendingHeraldTrinketDropCountByParticipantId: PendingHeraldTrinketDropCountByParticipantId,
    hadObservedRawTrinketBeforeFrame: boolean,
    previousRawTrinketItemId: number | undefined,
    currentRawTrinketItemId: number | undefined,
): TrinketRestoreResult {
    const currentTrinketItemId = getTrinketItemId(itemIds)
    if (currentTrinketItemId !== undefined) {
        pendingHeraldTrinketDropCountByParticipantId.delete(participantId)
        return { itemIds, inferredHeraldCapture: false }
    }

    const observedTrinketItemId = getObservedTrinketItemId(observedItems)
    const fallbackTrinketItemId = selectPreferredFallbackTrinketItemId(lastKnownTrinketItemId, observedTrinketItemId)
    if (fallbackTrinketItemId !== undefined) {
        const restoredItems = appendOrReplaceInferredItem(itemIds, fallbackTrinketItemId)
        const restoredTrinketItemId = getTrinketItemId(restoredItems)
        const previousTrinketItemId = getTrinketItemId(previousItemIds)
        const hadPreviousTrinket = previousTrinketItemId !== undefined
        const trinketDisappearedBetweenFrames =
            hadPreviousTrinket
            && previousTrinketItemId === fallbackTrinketItemId
            && !itemIds.includes(previousTrinketItemId)
        const droppedItemIds = getDroppedItemIds(previousItemIds, itemIds)
        const hasTrinketDrop =
            previousTrinketItemId !== undefined
            && droppedItemIds.includes(previousTrinketItemId)
        const rawTrinketDisappearedBetweenFrames =
            previousRawTrinketItemId !== undefined
            && previousRawTrinketItemId === fallbackTrinketItemId
            && currentRawTrinketItemId === undefined
        const isPendingHeraldTrinketDropCandidate =
            restoredTrinketItemId === fallbackTrinketItemId
            && trinketDisappearedBetweenFrames
            && rawTrinketDisappearedBetweenFrames
            && hasTrinketDrop
        const previousPendingCount = pendingHeraldTrinketDropCountByParticipantId.get(participantId) || 0
        let nextPendingCount = 0
        if (isPendingHeraldTrinketDropCandidate) {
            nextPendingCount = 1
        } else if (previousPendingCount > 0 && currentRawTrinketItemId === undefined) {
            nextPendingCount = Math.min(previousPendingCount + 1, 2)
        }
        if (nextPendingCount > 0) {
            pendingHeraldTrinketDropCountByParticipantId.set(participantId, nextPendingCount)
        } else {
            pendingHeraldTrinketDropCountByParticipantId.delete(participantId)
        }
        const inferredHeraldCapture =
            hadObservedRawTrinketBeforeFrame
            && previousPendingCount === 1
            && nextPendingCount === 2
        return {
            itemIds: restoredItems,
            inferredHeraldCapture,
        }
    }

    const shouldInferDefaultStealthWard =
        Number.isFinite(elapsedGameTimeMs)
        && Number(elapsedGameTimeMs) >= TRINKET_FALLBACK_INFERENCE_MIN_GAME_TIME_MS
        && !hasObservedTrinketItem(observedItems)
    if (!shouldInferDefaultStealthWard) {
        pendingHeraldTrinketDropCountByParticipantId.delete(participantId)
        return { itemIds, inferredHeraldCapture: false }
    }

    pendingHeraldTrinketDropCountByParticipantId.delete(participantId)
    return {
        itemIds: appendOrReplaceInferredItem(itemIds, 3340),
        inferredHeraldCapture: false,
    }
}

function getObservedTrinketItemId(observedItems: Set<number> | undefined) {
    if (!observedItems || observedItems.size === 0) return undefined
    return TRINKET_ITEM_PREFERENCE_ORDER.find((itemId) => observedItems.has(itemId))
}

function selectPreferredFallbackTrinketItemId(
    lastKnownTrinketItemId: number | undefined,
    observedTrinketItemId: number | undefined,
) {
    if (lastKnownTrinketItemId === undefined) return observedTrinketItemId
    if (observedTrinketItemId === undefined) return lastKnownTrinketItemId
    if (lastKnownTrinketItemId === observedTrinketItemId) return lastKnownTrinketItemId

    // Prefer concrete observed trinkets over inferred default stealth ward.
    if (lastKnownTrinketItemId === 3340 && observedTrinketItemId !== 3340) return observedTrinketItemId
    if (observedTrinketItemId === 3340 && lastKnownTrinketItemId !== 3340) return lastKnownTrinketItemId

    const lastKnownPriority = TRINKET_ITEM_PREFERENCE_ORDER.indexOf(lastKnownTrinketItemId)
    const observedPriority = TRINKET_ITEM_PREFERENCE_ORDER.indexOf(observedTrinketItemId)
    if (lastKnownPriority < 0) return observedTrinketItemId
    if (observedPriority < 0) return lastKnownTrinketItemId

    return observedPriority < lastKnownPriority ? observedTrinketItemId : lastKnownTrinketItemId
}

function hasObservedTrinketItem(observedItems: Set<number> | undefined) {
    if (!observedItems || observedItems.size === 0) return false
    return TRINKET_ITEM_IDS.some((itemId) => observedItems.has(itemId))
}

function resolveKnownBootItemId(previousBootItemId: number | undefined, lastKnownBootItemId: number | undefined) {
    if (previousBootItemId === undefined) return lastKnownBootItemId
    if (lastKnownBootItemId === undefined) return previousBootItemId
    if (previousBootItemId === lastKnownBootItemId) return previousBootItemId

    // Prefer real purchased boots over Magical Footwear snapshot once an upgrade appears.
    if (lastKnownBootItemId === SLIGHTLY_MAGICAL_FOOTWEAR_ITEM_ID && previousBootItemId !== SLIGHTLY_MAGICAL_FOOTWEAR_ITEM_ID && previousBootItemId !== 1001) {
        return previousBootItemId
    }
    if (previousBootItemId === SLIGHTLY_MAGICAL_FOOTWEAR_ITEM_ID && lastKnownBootItemId !== SLIGHTLY_MAGICAL_FOOTWEAR_ITEM_ID && lastKnownBootItemId !== 1001) {
        return lastKnownBootItemId
    }

    if (previousBootItemId === 1001 && lastKnownBootItemId !== 1001) return lastKnownBootItemId
    if (lastKnownBootItemId === 1001 && previousBootItemId !== 1001) return previousBootItemId

    // Keep an already-seen upgraded boot when the next frame regresses to a lower-tier source boot.
    if (isBootUpgradeOf(lastKnownBootItemId, previousBootItemId)) return lastKnownBootItemId
    if (isBootUpgradeOf(previousBootItemId, lastKnownBootItemId)) return previousBootItemId

    const previousBootFamilyAnchorItemId = getBootFamilyAnchorItemId(previousBootItemId)
    const lastKnownBootFamilyAnchorItemId = getBootFamilyAnchorItemId(lastKnownBootItemId)
    if (
        previousBootFamilyAnchorItemId !== undefined
        && lastKnownBootFamilyAnchorItemId !== undefined
        && previousBootFamilyAnchorItemId !== lastKnownBootFamilyAnchorItemId
    ) {
        // Conflicting families are usually payload glitches; keep the established family.
        return lastKnownBootItemId
    }

    return previousBootItemId
}

function getBootFamilyAnchorItemId(bootItemId: number | undefined) {
    if (bootItemId === undefined || bootItemId === 1001) return undefined

    let currentBootItemId = bootItemId
    const visitedBootItemIds = new Set<number>()
    while (!visitedBootItemIds.has(currentBootItemId)) {
        visitedBootItemIds.add(currentBootItemId)
        const sourceBootItemId = BOOT_SOURCE_ITEM_ID_BY_TARGET_ITEM_ID.get(currentBootItemId)
        if (!sourceBootItemId) return currentBootItemId
        currentBootItemId = sourceBootItemId
    }

    return currentBootItemId
}

function isBootUpgradeOf(candidateBootItemId: number, sourceBootItemId: number) {
    if (candidateBootItemId === sourceBootItemId) return false

    let currentBootItemId = sourceBootItemId
    const visitedBootItemIds = new Set<number>()

    while (!visitedBootItemIds.has(currentBootItemId)) {
        visitedBootItemIds.add(currentBootItemId)
        const upgradedBootItemId = BOOT_UPGRADE_TARGET_BY_SOURCE_ITEM_ID.get(currentBootItemId)
        if (!upgradedBootItemId) return false
        if (upgradedBootItemId === candidateBootItemId) return true
        currentBootItemId = upgradedBootItemId
    }

    return false
}

function normalizeUnexpectedDuplicateBootItems(
    itemIds: number[],
    previousItemIds: number[],
    lastKnownBootItemId: number | undefined,
    observedItems: Set<number> | undefined,
) {
    const currentBootItemIds = itemIds.filter((itemId) => BASE_AND_UPGRADED_BOOT_ITEM_IDS.includes(itemId))
    if (currentBootItemIds.length <= 1) return itemIds

    const preferredBootItemId = getPreferredBootItemIdForNormalization(currentBootItemIds, previousItemIds, lastKnownBootItemId, observedItems)
    if (preferredBootItemId === undefined) return itemIds

    let keptPreferredBoot = false
    return itemIds.filter((itemId) => {
        if (!BASE_AND_UPGRADED_BOOT_ITEM_IDS.includes(itemId)) return true
        if (itemId !== preferredBootItemId) return false
        if (keptPreferredBoot) return false
        keptPreferredBoot = true
        return true
    })
}

function normalizeSuspiciousBootRegression(
    itemIds: number[],
    previousItemIds: number[],
    lastKnownBootItemId: number | undefined,
) {
    const currentBootItemId = getBootItemId(itemIds)
    if (currentBootItemId === undefined) return itemIds

    const knownBootItemId = resolveKnownBootItemId(getBootItemId(previousItemIds), lastKnownBootItemId)
    if (knownBootItemId === undefined || knownBootItemId === currentBootItemId) return itemIds

    // Do not force-regress a newly observed upgraded boot back to Magical Footwear.
    if (
        knownBootItemId === SLIGHTLY_MAGICAL_FOOTWEAR_ITEM_ID
        && currentBootItemId !== SLIGHTLY_MAGICAL_FOOTWEAR_ITEM_ID
        && currentBootItemId !== 1001
    ) {
        return itemIds
    }

    const knownFamilyAnchorItemId = getBootFamilyAnchorItemId(knownBootItemId)
    const currentFamilyAnchorItemId = getBootFamilyAnchorItemId(currentBootItemId)

    const isRegressionToBasicBoots = currentBootItemId === 1001 && knownBootItemId !== 1001
    const isRegressionWithinSameBootChain = isBootUpgradeOf(knownBootItemId, currentBootItemId)
    const isConflictingBootFamily =
        knownFamilyAnchorItemId !== undefined
        && currentFamilyAnchorItemId !== undefined
        && knownFamilyAnchorItemId !== currentFamilyAnchorItemId

    if (!isRegressionToBasicBoots && !isRegressionWithinSameBootChain && !isConflictingBootFamily) return itemIds

    const currentBootItemIndex = itemIds.findIndex((itemId) => BASE_AND_UPGRADED_BOOT_ITEM_IDS.includes(itemId))
    if (currentBootItemIndex < 0) return itemIds
    return replaceItemAtIndex(itemIds, currentBootItemIndex, knownBootItemId)
}

function getPreferredBootItemIdForNormalization(
    currentBootItemIds: number[],
    previousItemIds: number[],
    lastKnownBootItemId: number | undefined,
    observedItems: Set<number> | undefined,
) {
    const nonMagicalCurrentBootItemIds = currentBootItemIds.filter((itemId) => itemId !== SLIGHTLY_MAGICAL_FOOTWEAR_ITEM_ID)
    if (currentBootItemIds.includes(SLIGHTLY_MAGICAL_FOOTWEAR_ITEM_ID) && nonMagicalCurrentBootItemIds.length > 0) {
        return getBootItemId(nonMagicalCurrentBootItemIds)
    }

    const previousBootItemId = getBootItemId(previousItemIds)
    const knownBootItemId = resolveKnownBootItemId(previousBootItemId, lastKnownBootItemId)
    if (knownBootItemId !== undefined && currentBootItemIds.includes(knownBootItemId)) return knownBootItemId

    if (knownBootItemId !== undefined) {
        const knownFamilyAnchorItemId = getBootFamilyAnchorItemId(knownBootItemId)
        if (knownFamilyAnchorItemId !== undefined) {
            const sameFamilyBootItemIds = currentBootItemIds.filter((itemId) => getBootFamilyAnchorItemId(itemId) === knownFamilyAnchorItemId)
            if (sameFamilyBootItemIds.length > 0) return getBootItemId(sameFamilyBootItemIds)
        }
    }

    const observedBootItemId = getStableObservedBootItemId(observedItems, knownBootItemId)
    if (observedBootItemId !== undefined && currentBootItemIds.includes(observedBootItemId)) return observedBootItemId

    return getBootItemId(currentBootItemIds)
}

function normalizeLikelyStaleTearBaseItem(
    itemIds: number[],
    previousItemIds: number[],
    participant: DetailsFrame[`participants`][number],
    observedItems: Set<number> | undefined,
) {
    if (!itemIds.includes(TEAR_OF_THE_GODDESS_ITEM_ID)) return itemIds

    const tearLineItemIds = itemIds.filter((itemId) => TEAR_LINE_SOURCE_AND_TARGET_ITEM_IDS.includes(itemId))
    if (tearLineItemIds.length === 0) return itemIds
    if (tearLineItemIds.length >= 2) return itemIds

    if (!previousItemIds.includes(TEAR_OF_THE_GODDESS_ITEM_ID)) return itemIds

    const previousTearLineItemIds = previousItemIds.filter((itemId) => TEAR_LINE_SOURCE_AND_TARGET_ITEM_IDS.includes(itemId))
    if (
        previousTearLineItemIds.length !== 1
        || previousTearLineItemIds[0] !== tearLineItemIds[0]
    ) return itemIds

    const activeBranch = getTearLineBranchByItemId(tearLineItemIds[0])
    if (!activeBranch) return itemIds
    if (hasEvidenceOfSecondaryTearBuild(itemIds, activeBranch, observedItems)) return itemIds

    const droppedItemIds = getDroppedItemIds(previousItemIds, itemIds)
    const droppedSameBranchHintCount =
        countMatchedItemIds(droppedItemIds, activeBranch.componentHintItemIds)
        + countMatchedItemIds(droppedItemIds, activeBranch.subComponentHintItemIds)
    const hasSparseLateGameInventory =
        (participant.level >= 13 || participant.totalGoldEarned >= 10000)
        && getCoreItemIds(itemIds).length <= EARLY_STALE_TEAR_INVENTORY_ITEM_COUNT_THRESHOLD
    const hadSparseInventoryPreviously = getCoreItemIds(previousItemIds).length <= EARLY_STALE_TEAR_INVENTORY_ITEM_COUNT_THRESHOLD

    if (droppedSameBranchHintCount === 0 && !(hasSparseLateGameInventory && hadSparseInventoryPreviously)) return itemIds

    let tearRemoved = false
    return itemIds.filter((itemId) => {
        if (itemId !== TEAR_OF_THE_GODDESS_ITEM_ID) return true
        if (tearRemoved) return false
        tearRemoved = true
        return false
    })
}

function inferShatteredArmguardFromUsedSeeker(itemIds: number[], previousItemIds: number[]) {
    if (itemIds.includes(SEEKER_ARMGUARD_ITEM_ID)) return itemIds
    if (itemIds.includes(SHATTERED_ARMGUARD_ITEM_ID)) return itemIds
    if (itemIds.includes(ZHONYAS_HOURGLASS_ITEM_ID)) return itemIds
    if (!previousItemIds.includes(SEEKER_ARMGUARD_ITEM_ID)) return itemIds

    return appendOrReplaceInferredItem(itemIds, SHATTERED_ARMGUARD_ITEM_ID)
}

function removeShatteredArmguardWhenZhonyaOwned(itemIds: number[]) {
    if (!itemIds.includes(ZHONYAS_HOURGLASS_ITEM_ID)) return itemIds
    if (!itemIds.includes(SHATTERED_ARMGUARD_ITEM_ID)) return itemIds

    return itemIds.filter((itemId) => itemId !== SHATTERED_ARMGUARD_ITEM_ID)
}

function getTearLineBranchByItemId(itemId: number) {
    return TEAR_LINE_UPGRADE_INFERENCE_BRANCHES.find((branch) =>
        branch.sourceItemId === itemId || branch.targetItemId === itemId
    )
}

function hasEvidenceOfSecondaryTearBuild(
    itemIds: number[],
    activeBranch: TearLineUpgradeInferenceBranch,
    observedItems: Set<number> | undefined,
) {
    const otherBranches = TEAR_LINE_UPGRADE_INFERENCE_BRANCHES.filter((branch) => branch !== activeBranch)
    return otherBranches.some((branch) => {
        const hasCurrentBranchHint =
            itemIds.some((itemId) => branch.componentHintItemIds.includes(itemId))
            || itemIds.some((itemId) => branch.subComponentHintItemIds.includes(itemId))
        if (hasCurrentBranchHint) return true

        if (!observedItems || observedItems.size === 0) return false
        return observedItems.has(branch.sourceItemId) || observedItems.has(branch.targetItemId)
    })
}

function hasCurrentTearBranchEvidence(itemIds: number[], branch: TearLineUpgradeInferenceBranch) {
    return itemIds.some((itemId) =>
        itemId === branch.sourceItemId
        || itemId === branch.targetItemId
        || branch.componentHintItemIds.includes(itemId)
        || branch.subComponentHintItemIds.includes(itemId)
    )
}

function getPreferredMidRecoveredBootItemId(bootItemId: number, observedItems: Set<number> | undefined) {
    let preferredBootItemId = bootItemId
    const visitedBootItemIds = new Set<number>()

    while (!visitedBootItemIds.has(preferredBootItemId)) {
        visitedBootItemIds.add(preferredBootItemId)
        const upgradedBootItemId = BOOT_UPGRADE_TARGET_BY_SOURCE_ITEM_ID.get(preferredBootItemId)
        if (!upgradedBootItemId) return preferredBootItemId

        // Only promote along the chain when we've actually observed the upgraded state.
        if (!observedItems || !observedItems.has(upgradedBootItemId)) return preferredBootItemId
        preferredBootItemId = upgradedBootItemId
    }

    return preferredBootItemId
}

function selectPreferredMidFallbackBootItemId(
    knownBootItemId: number | undefined,
    observedBootItemId: number | undefined,
) {
    if (knownBootItemId === undefined) return observedBootItemId
    if (observedBootItemId === undefined) return knownBootItemId

    if (knownBootItemId === observedBootItemId) return knownBootItemId
    if (knownBootItemId === 1001 && observedBootItemId !== 1001) return observedBootItemId
    if (observedBootItemId === 1001 && knownBootItemId !== 1001) return knownBootItemId

    if (isBootUpgradeOf(observedBootItemId, knownBootItemId)) return observedBootItemId
    if (isBootUpgradeOf(knownBootItemId, observedBootItemId)) return knownBootItemId

    return knownBootItemId
}

function selectPreferredBottomFallbackBootItemId(
    previousBootItemId: number,
    knownBootItemId: number | undefined,
) {
    if (knownBootItemId === undefined) return previousBootItemId
    if (!isBottomRecoverableBootItemId(knownBootItemId)) return previousBootItemId
    if (knownBootItemId === previousBootItemId) return previousBootItemId

    const previousIsTier2 = TIER2_BOOT_ITEM_IDS.includes(previousBootItemId)
    const knownIsTier2 = TIER2_BOOT_ITEM_IDS.includes(knownBootItemId)
    if (previousIsTier2 && !knownIsTier2) return previousBootItemId
    if (!previousIsTier2 && knownIsTier2) return knownBootItemId

    return previousBootItemId
}

function getTerminalTier3BootUpgradeItemId(sourceBootItemId: number) {
    let upgradedBootItemId = sourceBootItemId
    const visitedBootItemIds = new Set<number>()

    while (!visitedBootItemIds.has(upgradedBootItemId)) {
        visitedBootItemIds.add(upgradedBootItemId)
        const nextBootItemId = BOOT_UPGRADE_TARGET_BY_SOURCE_ITEM_ID.get(upgradedBootItemId)
        if (!nextBootItemId) {
            return TIER3_BOOT_ITEM_IDS.includes(upgradedBootItemId) ? upgradedBootItemId : undefined
        }
        upgradedBootItemId = nextBootItemId
    }

    return undefined
}

function getStableObservedBootItemId(
    observedItems: Set<number> | undefined,
    knownBootItemId?: number,
) {
    const observedBootItemIds = getObservedBootItemIds(observedItems)
    if (observedBootItemIds.length === 0) return undefined

    if (knownBootItemId !== undefined) {
        const knownBootFamilyAnchorItemId = getBootFamilyAnchorItemId(knownBootItemId)
        if (knownBootFamilyAnchorItemId !== undefined) {
            const sameFamilyObservedBootItemIds = observedBootItemIds.filter((itemId) =>
                getBootFamilyAnchorItemId(itemId) === knownBootFamilyAnchorItemId
            )
            if (sameFamilyObservedBootItemIds.length > 0) return sameFamilyObservedBootItemIds[0]
            return undefined
        }

        if (knownBootItemId === 1001) {
            const observedUpgradedBootItemIds = observedBootItemIds.filter((itemId) => itemId !== 1001)
            if (observedUpgradedBootItemIds.length > 0) return observedUpgradedBootItemIds[0]
            if (observedBootItemIds.includes(1001)) return 1001
        }
    }

    const observedBootFamilyAnchorItemIds = new Set<number>()
    observedBootItemIds.forEach((itemId) => {
        const bootFamilyAnchorItemId = getBootFamilyAnchorItemId(itemId)
        if (bootFamilyAnchorItemId !== undefined) {
            observedBootFamilyAnchorItemIds.add(bootFamilyAnchorItemId)
        }
    })

    if (observedBootFamilyAnchorItemIds.size === 1) {
        const [stableBootFamilyAnchorItemId] = Array.from(observedBootFamilyAnchorItemIds)
        return observedBootItemIds.find((itemId) =>
            getBootFamilyAnchorItemId(itemId) === stableBootFamilyAnchorItemId
        )
    }

    if (observedBootFamilyAnchorItemIds.size === 0 && observedBootItemIds.includes(1001)) return 1001
    return undefined
}

function getObservedBootItemIds(observedItems: Set<number> | undefined) {
    if (!observedItems || observedItems.size === 0) return []
    return BOOT_ITEM_PREFERENCE_ORDER.filter((itemId) => observedItems.has(itemId))
}

function isMidRole(participantRole: string | undefined) {
    return participantRole?.toLowerCase() === `mid`
}

function isBottomRole(participantRole: string | undefined) {
    return participantRole?.toLowerCase() === `bottom`
}

function isBottomRecoverableBootItemId(itemId: number) {
    return itemId === 1001 || itemId === SLIGHTLY_MAGICAL_FOOTWEAR_ITEM_ID || TIER2_BOOT_ITEM_IDS.includes(itemId)
}

function isBootInferencePairAllowedByKnownBoot(inferencePair: MissingItemInferencePair, knownBootItemId: number | undefined) {
    if (inferencePair.type !== `boots`) return true
    if (knownBootItemId === undefined) return true

    const knownFamilyAnchorItemId = getBootFamilyAnchorItemId(knownBootItemId)
    if (knownFamilyAnchorItemId === undefined) return true

    const pairFamilyAnchorItemId = getBootFamilyAnchorItemId(inferencePair.sourceItemId)
    return pairFamilyAnchorItemId === knownFamilyAnchorItemId
}

function canAggressivelyInferMissingItem(inferencePair: MissingItemInferencePair, currentItemIds: number[], previousItemIds: number[], participant: DetailsFrame[`participants`][number]) {
    const currentCoreItems = getCoreItemIds(currentItemIds)
    const sourceInCurrentItems = currentItemIds.includes(inferencePair.sourceItemId)
    const sourceInPreviousItems = previousItemIds.includes(inferencePair.sourceItemId)
    const targetInCurrentItems = currentItemIds.includes(inferencePair.targetItemId)

    if (inferencePair.type === `boots`) {
        if (targetInCurrentItems) return false
        // Only infer boot upgrades when the source boot genuinely disappeared between frames.
        // This avoids false promotions such as forcing Spellslinger's Shoes from late-game heuristics.
        return sourceInPreviousItems && !sourceInCurrentItems
    }

    if (sourceInPreviousItems && !sourceInCurrentItems) return true
    if (sourceInCurrentItems) {
        return participant.level >= 11 || participant.totalGoldEarned >= 8000 || currentCoreItems.length >= 3
    }
    return participant.level >= 14 || participant.totalGoldEarned >= 11000 || currentCoreItems.length >= 4

}

function appendOrReplaceInferredItem(itemIds: number[], targetItemId: number) {
    if (itemIds.includes(targetItemId)) return itemIds
    if (itemIds.length < MAX_INVENTORY_ITEM_SLOTS) return [...itemIds, targetItemId]

    const replacementIndex = getPreferredInferenceReplacementIndex(itemIds)
    if (replacementIndex < 0) return itemIds
    return replaceItemAtIndex(itemIds, replacementIndex, targetItemId)
}

function appendInferredItemIfSlotAvailable(itemIds: number[], targetItemId: number) {
    if (itemIds.includes(targetItemId)) return itemIds
    if (itemIds.length >= MAX_INVENTORY_ITEM_SLOTS) return itemIds
    return [...itemIds, targetItemId]
}

function getDroppedItemIds(previousItemIds: number[], currentItemIds: number[]) {
    if (previousItemIds.length === 0 || currentItemIds.length >= previousItemIds.length) return []

    const currentItemCounts = new Map<number, number>()
    currentItemIds.forEach((itemId) => {
        currentItemCounts.set(itemId, (currentItemCounts.get(itemId) || 0) + 1)
    })

    const droppedItemIds: number[] = []
    previousItemIds.forEach((itemId) => {
        const count = currentItemCounts.get(itemId) || 0
        if (count > 0) {
            currentItemCounts.set(itemId, count - 1)
            return
        }
        droppedItemIds.push(itemId)
    })

    return droppedItemIds
}

function getPreferredInferenceReplacementIndex(itemIds: number[]) {
    const consumableItemIndex = itemIds.findIndex((itemId) => isConsumableItemId(itemId))
    if (consumableItemIndex >= 0) return consumableItemIndex

    const trinketItemIndex = itemIds.findIndex((itemId) => isTrinketItemId(itemId))
    if (trinketItemIndex >= 0) return trinketItemIndex

    return -1
}

function replaceItemAtIndex(itemIds: number[], index: number, replacementItemId: number) {
    if (index < 0 || index >= itemIds.length) return itemIds
    const replacedItemIds = itemIds.slice()
    replacedItemIds[index] = replacementItemId
    return replacedItemIds
}

function shouldKeepPreviousOnSuspiciousDrop(currentItems: number[], previousItems: number[]) {
    if (previousItems.length === 0 || currentItems.length === 0) return false

    const totalItemsDropped = previousItems.length - currentItems.length
    if (totalItemsDropped < 2) return false

    const retainedItems = countIntersectionWithCounts(previousItems, currentItems)
    const newItems = currentItems.length - retainedItems

    const previousCoreItems = getCoreItemIds(previousItems)
    const currentCoreItems = getCoreItemIds(currentItems)
    const retainedCoreItems = countIntersectionWithCounts(previousCoreItems, currentCoreItems)
    const newCoreItems = currentCoreItems.length - retainedCoreItems
    const coreItemsDropped = previousCoreItems.length - currentCoreItems.length

    // If total slots drop hard without meaningful replacements, this is usually a partial payload.
    if (newItems <= 1 && newCoreItems === 0) return true

    // If most previous core items vanish and there are not enough new core replacements,
    // this is usually a partial/buggy payload from live stats.
    if (previousCoreItems.length >= 3 && coreItemsDropped >= 2 && retainedCoreItems <= previousCoreItems.length - 2 && newCoreItems === 0) return true

    // Additional fallback for severe abrupt drops.
    if (totalItemsDropped >= 3 && currentCoreItems.length <= previousCoreItems.length - 2 && newCoreItems === 0) return true

    return false
}

function getCoreItemIds(itemIds: number[]) {
    return itemIds.filter((itemId) => !isTrinketItemId(itemId) && !isConsumableItemId(itemId))
}

function getNonBootEquipmentItemIds(itemIds: number[]) {
    return getCoreItemIds(itemIds).filter((itemId) => !BASE_AND_UPGRADED_BOOT_ITEM_IDS.includes(itemId))
}

function isTrinketItemId(itemId: number) {
    return TRINKET_ITEM_IDS.includes(itemId)
}

function isConsumableItemId(itemId: number) {
    return CONSUMABLE_ITEM_IDS.includes(itemId)
}

function countIntersectionWithCounts(reference: number[], candidate: number[]) {
    const referenceCounts = new Map<number, number>()
    reference.forEach((itemId) => {
        referenceCounts.set(itemId, (referenceCounts.get(itemId) || 0) + 1)
    })

    let retainedCount = 0
    candidate.forEach((itemId) => {
        const count = referenceCounts.get(itemId) || 0
        if (count <= 0) return
        referenceCounts.set(itemId, count - 1)
        retainedCount++
    })

    return retainedCount
}

function isSubsetWithCounts(candidate: number[], reference: number[]) {
    const referenceCounts = new Map<number, number>()
    reference.forEach((itemId) => {
        referenceCounts.set(itemId, (referenceCounts.get(itemId) || 0) + 1)
    })

    for (const itemId of candidate) {
        const count = referenceCounts.get(itemId) || 0
        if (count <= 0) return false
        referenceCounts.set(itemId, count - 1)
    }

    return true
}

function buildObjectiveTimerBackfillSeedFromWindowFrames(
    frames: WindowFrame[],
    fallbackCurrentTimestampValue: number,
): ObjectiveTimerBackfillSeed | undefined {
    const normalizedFrames = frames
        .map((frame) => ({
            frame,
            timestampValue: getTimestampValue(frame.rfc460Timestamp),
        }))
        .filter(({ timestampValue }) => timestampValue > 0)
        .sort((a, b) => a.timestampValue - b.timestampValue)

    if (normalizedFrames.length === 0) return undefined

    const firstFrame = normalizedFrames[0].frame
    let previousBaronCounts = {
        blue: Number(firstFrame.blueTeam.barons || 0),
        red: Number(firstFrame.redTeam.barons || 0),
    }
    let previousDragonKillCount = getFrameDragonKillCount(firstFrame)
    let previousDragonTypesByTeam = {
        blue: getNormalizedFrameDragonTypes(firstFrame.blueTeam.dragons),
        red: getNormalizedFrameDragonTypes(firstFrame.redTeam.dragons),
    }

    let lastBaronKillTimestampMs: number | null = null
    let lastDragonKillTimestampMs: number | null = null
    const baronPowerPlaySnapshotByTeam: ObjectiveTimerBackfillSeed[`baronPowerPlaySnapshotByTeam`] = {
        blue: null,
        red: null,
    }
    const baronBuffParticipantIdsByTeam = {
        blue: new Set<number>(),
        red: new Set<number>(),
    }
    const elderBuffEndAtMsByTeam: ObjectiveTimerBackfillSeed[`elderBuffEndAtMsByTeam`] = {
        blue: null,
        red: null,
    }
    const elderBuffParticipantIdsByTeam = {
        blue: new Set<number>(),
        red: new Set<number>(),
    }

    normalizedFrames.forEach(({ frame, timestampValue }) => {
        const currentBaronCounts = {
            blue: Number(frame.blueTeam.barons || 0),
            red: Number(frame.redTeam.barons || 0),
        }
        const blueTeamLead = Number(frame.blueTeam.totalGold || 0) - Number(frame.redTeam.totalGold || 0)
        const redTeamLead = -blueTeamLead

        if (currentBaronCounts.blue > previousBaronCounts.blue) {
            lastBaronKillTimestampMs = timestampValue
            baronPowerPlaySnapshotByTeam.blue = {
                baseLead: blueTeamLead,
                startedAtMs: timestampValue,
            }
            baronBuffParticipantIdsByTeam.blue = getAliveFrameParticipantIdSet(frame.blueTeam.participants)
        }
        if (currentBaronCounts.red > previousBaronCounts.red) {
            lastBaronKillTimestampMs = timestampValue
            baronPowerPlaySnapshotByTeam.red = {
                baseLead: redTeamLead,
                startedAtMs: timestampValue,
            }
            baronBuffParticipantIdsByTeam.red = getAliveFrameParticipantIdSet(frame.redTeam.participants)
        }

        removeDeadFrameParticipantsFromSet(baronBuffParticipantIdsByTeam.blue, frame.blueTeam.participants)
        removeDeadFrameParticipantsFromSet(baronBuffParticipantIdsByTeam.red, frame.redTeam.participants)

        const currentDragonKillCount = getFrameDragonKillCount(frame)
        if (currentDragonKillCount > previousDragonKillCount) {
            lastDragonKillTimestampMs = timestampValue
        }

        const currentDragonTypesByTeam = {
            blue: getNormalizedFrameDragonTypes(frame.blueTeam.dragons),
            red: getNormalizedFrameDragonTypes(frame.redTeam.dragons),
        }
        const blueAddedDragonTypes = getAddedDragonTypesWithCounts(previousDragonTypesByTeam.blue, currentDragonTypesByTeam.blue)
        const redAddedDragonTypes = getAddedDragonTypesWithCounts(previousDragonTypesByTeam.red, currentDragonTypesByTeam.red)

        if (blueAddedDragonTypes.some(isElderDragonTypeFromFrame)) {
            elderBuffEndAtMsByTeam.blue = timestampValue + ELDER_DRAGON_BUFF_DURATION_MS
            elderBuffParticipantIdsByTeam.blue = getAliveFrameParticipantIdSet(frame.blueTeam.participants)
        }
        if (redAddedDragonTypes.some(isElderDragonTypeFromFrame)) {
            elderBuffEndAtMsByTeam.red = timestampValue + ELDER_DRAGON_BUFF_DURATION_MS
            elderBuffParticipantIdsByTeam.red = getAliveFrameParticipantIdSet(frame.redTeam.participants)
        }

        removeDeadFrameParticipantsFromSet(elderBuffParticipantIdsByTeam.blue, frame.blueTeam.participants)
        removeDeadFrameParticipantsFromSet(elderBuffParticipantIdsByTeam.red, frame.redTeam.participants)

        previousBaronCounts = currentBaronCounts
        previousDragonKillCount = currentDragonKillCount
        previousDragonTypesByTeam = currentDragonTypesByTeam
    })

    const latestObservedTimestampValue = normalizedFrames[normalizedFrames.length - 1].timestampValue
    const currentTimestampValue = Math.max(latestObservedTimestampValue, fallbackCurrentTimestampValue)

    ;([`blue`, `red`] as const).forEach((teamKey) => {
        const baronSnapshot = baronPowerPlaySnapshotByTeam[teamKey]
        if (baronSnapshot) {
            const elapsedMs = Math.max(0, currentTimestampValue - baronSnapshot.startedAtMs)
            if (elapsedMs >= BARON_POWER_PLAY_DURATION_MS || baronBuffParticipantIdsByTeam[teamKey].size === 0) {
                baronPowerPlaySnapshotByTeam[teamKey] = null
                baronBuffParticipantIdsByTeam[teamKey].clear()
            }
        }

        const elderBuffEndAtMs = elderBuffEndAtMsByTeam[teamKey]
        if (
            elderBuffEndAtMs !== null
            && (elderBuffEndAtMs <= currentTimestampValue || elderBuffParticipantIdsByTeam[teamKey].size === 0)
        ) {
            elderBuffEndAtMsByTeam[teamKey] = null
            elderBuffParticipantIdsByTeam[teamKey].clear()
        }
    })

    return {
        lastBaronKillTimestampMs,
        lastDragonKillTimestampMs,
        baronPowerPlaySnapshotByTeam,
        baronBuffParticipantIdsByTeam: {
            blue: Array.from(baronBuffParticipantIdsByTeam.blue),
            red: Array.from(baronBuffParticipantIdsByTeam.red),
        },
        elderBuffEndAtMsByTeam,
        elderBuffParticipantIdsByTeam: {
            blue: Array.from(elderBuffParticipantIdsByTeam.blue),
            red: Array.from(elderBuffParticipantIdsByTeam.red),
        },
    }
}

function getAliveFrameParticipantIdSet(participants: WindowParticipant[] | undefined) {
    return new Set<number>(
        (participants || [])
            .filter((participant) => Number(participant.currentHealth) > 0)
            .map((participant) => participant.participantId),
    )
}

function removeDeadFrameParticipantsFromSet(participantIds: Set<number>, participants: WindowParticipant[] | undefined) {
    ;(participants || []).forEach((participant) => {
        if (Number(participant.currentHealth) <= 0) {
            participantIds.delete(participant.participantId)
        }
    })
}

function getFrameDragonKillCount(frame: WindowFrame) {
    const blueTeamDragonKillCount = Array.isArray(frame.blueTeam.dragons) ? frame.blueTeam.dragons.length : 0
    const redTeamDragonKillCount = Array.isArray(frame.redTeam.dragons) ? frame.redTeam.dragons.length : 0
    return blueTeamDragonKillCount + redTeamDragonKillCount
}

function getNormalizedFrameDragonTypes(dragonTypes: string[] | undefined) {
    if (!Array.isArray(dragonTypes)) return []
    return dragonTypes.map((dragonType) => String(dragonType || ``).trim().toLowerCase()).filter(Boolean)
}

function getAddedDragonTypesWithCounts(previousDragonTypes: string[], currentDragonTypes: string[]) {
    const previousDragonTypeCounts = new Map<string, number>()
    previousDragonTypes.forEach((dragonType) => {
        previousDragonTypeCounts.set(dragonType, (previousDragonTypeCounts.get(dragonType) || 0) + 1)
    })

    const addedDragonTypes: string[] = []
    currentDragonTypes.forEach((dragonType) => {
        const previousCount = previousDragonTypeCounts.get(dragonType) || 0
        if (previousCount > 0) {
            previousDragonTypeCounts.set(dragonType, previousCount - 1)
            return
        }

        addedDragonTypes.push(dragonType)
    })

    return addedDragonTypes
}

function isElderDragonTypeFromFrame(dragonType: string) {
    const normalizedDragonType = String(dragonType || ``).trim().toLowerCase()
    return normalizedDragonType === `elder` || normalizedDragonType.includes(`elder`)
}

function getLiveDetailsBackfillStartTimestampValue(
    initialWindowStartTimestampValue: number,
    currentWindowTimestampValue: number,
    currentGame: EventDetails[`match`][`games`][number],
    lastWindowFrame: WindowFrame,
) {
    if (currentWindowTimestampValue === 0) return 0

    const shouldFallback = shouldUseLiveDetailsBackfillFallback(currentGame, lastWindowFrame)
    if (initialWindowStartTimestampValue === 0) {
        return shouldFallback
            ? Math.max(0, currentWindowTimestampValue - LIVE_DETAILS_BACKFILL_FALLBACK_LOOKBACK_MS)
            : 0
    }

    if (currentWindowTimestampValue <= initialWindowStartTimestampValue) {
        // Some finished games return nearly static window snapshots.
        // In that case, rely on fallback lookback instead of skipping forever.
        return shouldFallback
            ? Math.max(0, currentWindowTimestampValue - LIVE_DETAILS_BACKFILL_FALLBACK_LOOKBACK_MS)
            : 0
    }

    const elapsedGameTime = currentWindowTimestampValue - initialWindowStartTimestampValue
    if (elapsedGameTime >= LIVE_DETAILS_BACKFILL_MINIMUM_GAME_TIME_MS) {
        return initialWindowStartTimestampValue
    }

    if (!shouldFallback) return 0

    return Math.max(0, currentWindowTimestampValue - LIVE_DETAILS_BACKFILL_FALLBACK_LOOKBACK_MS)
}

function shouldUseLiveDetailsBackfillFallback(
    currentGame: EventDetails[`match`][`games`][number],
    lastWindowFrame: WindowFrame,
) {
    if (currentGame.state === `completed` || lastWindowFrame.gameState === `finished`) return true

    const averageParticipantLevel = getAverageWindowParticipantLevel(lastWindowFrame)
    const totalTeamGold = Number(lastWindowFrame.blueTeam.totalGold || 0) + Number(lastWindowFrame.redTeam.totalGold || 0)

    return (
        averageParticipantLevel >= LIVE_DETAILS_BACKFILL_FALLBACK_MIN_AVERAGE_LEVEL
        || totalTeamGold >= LIVE_DETAILS_BACKFILL_FALLBACK_MIN_TOTAL_GOLD
    )
}

function getAverageWindowParticipantLevel(lastWindowFrame: WindowFrame) {
    const participants = lastWindowFrame.blueTeam.participants.concat(lastWindowFrame.redTeam.participants)
    if (participants.length === 0) return 0

    const totalLevels = participants.reduce((sum, participant) => {
        return sum + (Number.isFinite(participant.level) ? participant.level : 0)
    }, 0)
    return totalLevels / participants.length
}

function inferWinnerSideFromWindowFrame(lastWindowFrame: WindowFrame): `blue` | `red` | undefined {
    const blueInhibitors = Number(lastWindowFrame.blueTeam.inhibitors || 0)
    const redInhibitors = Number(lastWindowFrame.redTeam.inhibitors || 0)
    if (blueInhibitors > 0 && redInhibitors === 0) return `blue`
    if (redInhibitors > 0 && blueInhibitors === 0) return `red`

    const blueGold = Number(lastWindowFrame.blueTeam.totalGold || 0)
    const redGold = Number(lastWindowFrame.redTeam.totalGold || 0)
    if (blueGold !== redGold) return blueGold > redGold ? `blue` : `red`

    const blueKills = getTeamKillCountFromWindowParticipants(lastWindowFrame.blueTeam.participants)
    const redKills = getTeamKillCountFromWindowParticipants(lastWindowFrame.redTeam.participants)
    if (blueKills !== redKills) return blueKills > redKills ? `blue` : `red`

    return undefined
}

function getTeamKillCountFromWindowParticipants(participants: Array<{ kills: number }> | undefined) {
    if (!Array.isArray(participants)) return 0
    return participants.reduce((sum, participant) => sum + Number(participant.kills || 0), 0)
}

function getTimestampValue(timestamp: string | Date | undefined) {
    if (!timestamp) return 0
    const value = new Date(timestamp).getTime()
    return Number.isFinite(value) ? value : 0
}

function getPlaybackActiveDelayMs(previousTimestampValue: number, nextTimestampValue: number) {
    if (previousTimestampValue <= 0 || nextTimestampValue <= 0) return WINDOW_PLAYBACK_MIN_ACTIVE_TICK_INTERVAL_MS
    const deltaMs = Math.max(0, nextTimestampValue - previousTimestampValue)
    if (deltaMs <= 0) return WINDOW_PLAYBACK_MIN_ACTIVE_TICK_INTERVAL_MS
    return Math.max(
        WINDOW_PLAYBACK_MIN_ACTIVE_TICK_INTERVAL_MS,
        Math.min(WINDOW_PLAYBACK_MAX_ACTIVE_TICK_INTERVAL_MS, deltaMs),
    )
}

function hasRenderableWindowFrameDiff(previousFrame: WindowFrame | undefined, nextFrame: WindowFrame) {
    if (!previousFrame) return true
    if (previousFrame.gameState !== nextFrame.gameState) return true
    return hasRenderableTeamStatsDiff(previousFrame.blueTeam, nextFrame.blueTeam)
        || hasRenderableTeamStatsDiff(previousFrame.redTeam, nextFrame.redTeam)
}

function hasRenderableTeamStatsDiff(previousTeamStats: WindowFrame[`blueTeam`], nextTeamStats: WindowFrame[`blueTeam`]) {
    if (Number(previousTeamStats.totalGold || 0) !== Number(nextTeamStats.totalGold || 0)) return true
    if (Number(previousTeamStats.inhibitors || 0) !== Number(nextTeamStats.inhibitors || 0)) return true
    if (Number(previousTeamStats.towers || 0) !== Number(nextTeamStats.towers || 0)) return true
    if (Number(previousTeamStats.barons || 0) !== Number(nextTeamStats.barons || 0)) return true
    if (Number(previousTeamStats.totalKills || 0) !== Number(nextTeamStats.totalKills || 0)) return true

    const previousDragons = previousTeamStats.dragons || []
    const nextDragons = nextTeamStats.dragons || []
    if (previousDragons.length !== nextDragons.length) return true
    for (let dragonIndex = 0; dragonIndex < previousDragons.length; dragonIndex++) {
        if (String(previousDragons[dragonIndex] || ``) !== String(nextDragons[dragonIndex] || ``)) return true
    }

    return hasRenderableWindowParticipantDiff(previousTeamStats.participants, nextTeamStats.participants)
}

function hasRenderableWindowParticipantDiff(previousParticipants: WindowParticipant[] | undefined, nextParticipants: WindowParticipant[] | undefined) {
    const previousParticipantsSafe = previousParticipants || []
    const nextParticipantsSafe = nextParticipants || []
    if (previousParticipantsSafe.length !== nextParticipantsSafe.length) return true

    for (let participantIndex = 0; participantIndex < previousParticipantsSafe.length; participantIndex++) {
        const previousParticipant = previousParticipantsSafe[participantIndex]
        const nextParticipant = nextParticipantsSafe[participantIndex]
        if (!previousParticipant || !nextParticipant) return true
        if (Number(previousParticipant.participantId || 0) !== Number(nextParticipant.participantId || 0)) return true
        if (Number(previousParticipant.totalGold || 0) !== Number(nextParticipant.totalGold || 0)) return true
        if (Number(previousParticipant.level || 0) !== Number(nextParticipant.level || 0)) return true
        if (Number(previousParticipant.kills || 0) !== Number(nextParticipant.kills || 0)) return true
        if (Number(previousParticipant.deaths || 0) !== Number(nextParticipant.deaths || 0)) return true
        if (Number(previousParticipant.assists || 0) !== Number(nextParticipant.assists || 0)) return true
        if (Number(previousParticipant.creepScore || 0) !== Number(nextParticipant.creepScore || 0)) return true
        if (Number(previousParticipant.currentHealth || 0) !== Number(nextParticipant.currentHealth || 0)) return true
        if (Number(previousParticipant.maxHealth || 0) !== Number(nextParticipant.maxHealth || 0)) return true
    }

    return false
}

function getElapsedGameTimeMs(startTimestamp: string | Date | undefined, currentTimestamp: string | Date | undefined) {
    const startTimestampValue = getTimestampValue(startTimestamp)
    const currentTimestampValue = getTimestampValue(currentTimestamp)
    if (startTimestampValue === 0 || currentTimestampValue === 0 || currentTimestampValue < startTimestampValue) {
        return undefined
    }
    return currentTimestampValue - startTimestampValue
}

function normalizeTimestamp(timestamp: string | Date | undefined) {
    if (!timestamp) return ``
    const parsedDate = new Date(timestamp)
    const parsedTimestamp = parsedDate.getTime()
    if (!Number.isFinite(parsedTimestamp)) return ``
    return parsedDate.toISOString()
}

function alignTimestampToLiveStatsStep(timestampValue: number) {
    if (!Number.isFinite(timestampValue) || timestampValue <= 0) return 0
    return timestampValue - (timestampValue % LIVE_STATS_STARTING_TIME_STEP_MS)
}

function getDebugSimulationJumpMinuteOptions(startTimestamp: string, endTimestamp: string) {
    const startTimestampValue = getTimestampValue(startTimestamp)
    const endTimestampValue = getTimestampValue(endTimestamp)
    if (startTimestampValue <= 0 || endTimestampValue <= startTimestampValue) return []

    // Keep teleport targets strictly before game end (no exact-finish jump).
    const maxJumpMinute = Math.floor(
        ((endTimestampValue - startTimestampValue - 1) / ONE_MINUTE_MS) / DEBUG_SIMULATION_JUMP_STEP_MINUTES
    ) * DEBUG_SIMULATION_JUMP_STEP_MINUTES
    if (maxJumpMinute < DEBUG_SIMULATION_JUMP_STEP_MINUTES) return []

    const minuteOptions: number[] = []
    for (let targetMinute = DEBUG_SIMULATION_JUMP_STEP_MINUTES; targetMinute <= maxJumpMinute; targetMinute += DEBUG_SIMULATION_JUMP_STEP_MINUTES) {
        minuteOptions.push(targetMinute)
    }
    return minuteOptions
}

function areNumberArraysEqual(left: number[], right: number[]) {
    if (left === right) return true
    if (left.length !== right.length) return false
    for (let index = 0; index < left.length; index++) {
        if (left[index] !== right[index]) return false
    }
    return true
}

function getCompletedGameSnapshotStartingTime(firstWindowTimestamp: string) {
    const firstWindowTimestampValue = getTimestampValue(firstWindowTimestamp)
    if (firstWindowTimestampValue === 0) return getISODateMultiplyOf10()

    // Query after game start to get tail frames for completed games.
    // Clamp against (now - 60s) so we never request a future/too-fresh window.
    const fourHoursAfterStartTimestampValue = firstWindowTimestampValue + (4 * 60 * 60 * 1000)
    const safeNowTimestampValue = Date.now() - (60 * 1000)
    const completedGameTailTimestampValue = alignTimestampToLiveStatsStep(
        Math.min(fourHoursAfterStartTimestampValue, safeNowTimestampValue)
    )
    if (completedGameTailTimestampValue === 0) return getISODateMultiplyOf10()
    return new Date(completedGameTailTimestampValue).toISOString()
}
