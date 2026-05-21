import './styles/playerStatusStyle.css'

import { GameMetadata, Team, WindowFrame, WindowParticipant } from "../types/baseTypes";

import { useEffect, useRef } from "react";
import { ToastContainer, toast } from 'react-toastify';
import { ReactComponent as KillFeedSVG } from '../../assets/images/kill.svg';

const kill = require("../../assets/audios/champion_slain.ogg");
const first_blood = require("../../assets/audios/first_blood.ogg");
const executed = require("../../assets/audios/executed.ogg");
const blue_ace = require("../../assets/audios/blue_ace.ogg");
const red_ace = require("../../assets/audios/red_ace.ogg");
const welcome_rift = require("../../assets/audios/welcome_rift.ogg");
const tower_blue = require("../../assets/audios/blue_turret_destroyed.ogg");
const tower_red = require("../../assets/audios/red_turret_destroyed.ogg");
const dragon_blue = require("../../assets/audios/blue_dragon_slain.ogg");
const dragon_red = require("../../assets/audios/red_dragon_slain.ogg");
const baron_blue = require("../../assets/audios/blue_baron_slain.ogg");
const baron_red = require("../../assets/audios/red_baron_slain.ogg");
const inib_blue = require("../../assets/audios/blue_inhibitor_destroyed.ogg");
const inib_red = require("../../assets/audios/red_inhibitor_destroyed.ogg");
const DEBUG_PREVIEW_TOAST_IDS = [`debug_preview_blue_objective`, `debug_preview_red_objective`, `debug_preview_execution`, `debug_preview_kill_feed_blue`, `debug_preview_kill_feed_red`]

type Props = {
    lastWindowFrame: WindowFrame,
    gameIndex: number,
    elapsedGameTimeSeconds: number,
    gameMetadata: GameMetadata,
    championsUrlWithPatchVersion: string,
    blueTeam: Team,
    redTeam: Team,
    debugShowAllDataEnabled?: boolean,
    isBasicCompactLayout?: boolean,
}

type StatusWatcher = {
    rfc460Timestamp: string,
    elapsedGameTimeSeconds: number,
    totalKills: {
        blue: number,
        red: number,
    }
    inhibitors: {
        blue: number,
        red: number
    }
    dragons: {
        blue: number,
        red: number
    }
    towers: {
        blue: number,
        red: number
    }
    barons: {
        blue: number,
        red: number
    }
    participants: {
        blue: WindowParticipant[]
        red: WindowParticipant[]
    }
    gameIndex: number
}

type ToastEvent = {
    blueTeam: boolean;
    sound: string;
    message?: string;
    image?: string;
    diff?: number;
    eventType?: "kill";
    assistants?: string[];
    killers?: string[];
    victims?: string[];
}

type ParticipantDeltaEntry = {
    participantId: number;
    championIcon: string;
    delta: number;
}

export function LiveAPIWatcher({ lastWindowFrame, gameIndex, elapsedGameTimeSeconds, gameMetadata, championsUrlWithPatchVersion, blueTeam, redTeam, debugShowAllDataEnabled = false, isBasicCompactLayout = false }: Props) {
    let trueBlueTeam = blueTeam
    let trueRedTeam = redTeam
    let swapTeams = blueTeam.id !== gameMetadata.blueTeamMetadata.esportsTeamId
    if (swapTeams) {
        trueBlueTeam = redTeam
        trueRedTeam = blueTeam
    }

    const statusRef = useRef<StatusWatcher>({
        rfc460Timestamp: lastWindowFrame.rfc460Timestamp,
        elapsedGameTimeSeconds: elapsedGameTimeSeconds,
        totalKills: {
            blue: getTeamKillCountFromParticipants(lastWindowFrame.blueTeam.participants),
            red: getTeamKillCountFromParticipants(lastWindowFrame.redTeam.participants),
        },
        dragons: { blue: lastWindowFrame.blueTeam.dragons.length, red: lastWindowFrame.redTeam.dragons.length },
        gameIndex: gameIndex,
        inhibitors: { blue: lastWindowFrame.blueTeam.inhibitors, red: lastWindowFrame.redTeam.inhibitors },
        towers: { blue: lastWindowFrame.blueTeam.towers, red: lastWindowFrame.redTeam.towers },
        barons: { blue: lastWindowFrame.blueTeam.barons, red: lastWindowFrame.redTeam.barons },
        participants: { blue: lastWindowFrame.blueTeam.participants, red: lastWindowFrame.redTeam.participants }
    })

    const welcomeRiftPlayedRef = useRef<{ gameIndex: number, played: boolean }>({
        gameIndex: gameIndex,
        played: elapsedGameTimeSeconds >= 1,
    })

    const firstBloodPlayedRef = useRef<{ gameIndex: number, played: boolean }>({
        gameIndex: gameIndex,
        played: (
            getTeamKillCountFromParticipants(lastWindowFrame.blueTeam.participants)
            + getTeamKillCountFromParticipants(lastWindowFrame.redTeam.participants)
        ) > 0,
    })

    useEffect(() => {
        const soundData = localStorage.getItem("sound");
        const isMuted = soundData !== "unmute";
        let status = statusRef.current
        const latestMergedFrame = lastWindowFrame
        const previousStatusTimestampValue = getTimestampValue(status.rfc460Timestamp)
        const latestMergedTimestampValue = getTimestampValue(latestMergedFrame.rfc460Timestamp)
        if (status.gameIndex !== gameIndex || latestMergedTimestampValue < previousStatusTimestampValue) {
            statusRef.current = buildStatusWatcher(latestMergedFrame, gameIndex, elapsedGameTimeSeconds)
            return
        }

        const framesToProcess = latestMergedTimestampValue > previousStatusTimestampValue ? [latestMergedFrame] : []

        if (framesToProcess.length === 0) {
            return
        }

        const latestIncomingFrame = framesToProcess[framesToProcess.length - 1]
        const latestIncomingTotalKills = {
            blue: getTeamKillCountFromParticipants(latestIncomingFrame.blueTeam.participants),
            red: getTeamKillCountFromParticipants(latestIncomingFrame.redTeam.participants),
        }

        if (firstBloodPlayedRef.current.gameIndex !== gameIndex) {
            firstBloodPlayedRef.current = {
                gameIndex,
                played: (latestIncomingTotalKills.blue + latestIncomingTotalKills.red) > 0,
            }
        }
        if (welcomeRiftPlayedRef.current.gameIndex !== gameIndex) {
            welcomeRiftPlayedRef.current = {
                gameIndex,
                played: elapsedGameTimeSeconds >= 1,
            }
        }

        let soundAlreadyPlaying = isMuted;
        framesToProcess.forEach((frame, frameIndex) => {
            const toastQueue: ToastEvent[] = []
            const currentTotalKills = {
                blue: getTeamKillCountFromParticipants(frame.blueTeam.participants),
                red: getTeamKillCountFromParticipants(frame.redTeam.participants),
            }
            const totalKillsBefore = status.totalKills.blue + status.totalKills.red
            const totalKillsNow = currentTotalKills.blue + currentTotalKills.red

            if (status.gameIndex === gameIndex) {
                if (status.inhibitors.blue !== frame.blueTeam.inhibitors) {
                    toastQueue.push({ blueTeam: true, sound: inib_red.default, message: "\uC5B5\uC81C\uAE30 \uD30C\uAD34", image: trueBlueTeam.image })
                }

                if (status.inhibitors.red !== frame.redTeam.inhibitors) {
                    toastQueue.push({ blueTeam: false, sound: inib_blue.default, message: "\uC5B5\uC81C\uAE30 \uD30C\uAD34", image: trueRedTeam.image })
                }

                if (status.barons.blue !== frame.blueTeam.barons) {
                    toastQueue.push({ blueTeam: true, sound: baron_blue.default, message: "\uBC14\uB860 \uCC98\uCE58", image: trueBlueTeam.image })
                }

                if (status.barons.red !== frame.redTeam.barons) {
                    toastQueue.push({ blueTeam: false, sound: baron_red.default, message: "\uBC14\uB860 \uCC98\uCE58", image: trueRedTeam.image })
                }

                if (status.dragons.blue !== frame.blueTeam.dragons.length) {
                    toastQueue.push({ blueTeam: true, sound: dragon_blue.default, message: "\uB4DC\uB798\uACE4 \uCC98\uCE58", image: trueBlueTeam.image })
                }

                if (status.dragons.red !== frame.redTeam.dragons.length) {
                    toastQueue.push({ blueTeam: false, sound: dragon_red.default, message: "\uB4DC\uB798\uACE4 \uCC98\uCE58", image: trueRedTeam.image })
                }

                if (status.towers.blue !== frame.blueTeam.towers) {
                    toastQueue.push({ blueTeam: true, sound: tower_red.default, message: "\uD0C0\uC6CC \uD30C\uAD34", image: trueBlueTeam.image })
                }

                if (status.towers.red !== frame.redTeam.towers) {
                    toastQueue.push({ blueTeam: false, sound: tower_blue.default, message: "\uD0C0\uC6CC \uD30C\uAD34", image: trueRedTeam.image })
                }

                const blueKillToastEvents = buildKillToastEvents(
                    true,
                    status.participants.blue,
                    frame.blueTeam.participants,
                    gameMetadata.blueTeamMetadata.participantMetadata,
                    status.participants.red,
                    frame.redTeam.participants,
                    gameMetadata.redTeamMetadata.participantMetadata,
                    championsUrlWithPatchVersion,
                )
                if (blueKillToastEvents.length > 0) {
                    toastQueue.push(...blueKillToastEvents)
                }

                const redKillToastEvents = buildKillToastEvents(
                    false,
                    status.participants.red,
                    frame.redTeam.participants,
                    gameMetadata.redTeamMetadata.participantMetadata,
                    status.participants.blue,
                    frame.blueTeam.participants,
                    gameMetadata.blueTeamMetadata.participantMetadata,
                    championsUrlWithPatchVersion,
                )
                if (redKillToastEvents.length > 0) {
                    toastQueue.push(...redKillToastEvents)
                }

                const blueDeathIncreaseEvents = getDeathIncreaseToastEvents(
                    status.participants.blue,
                    frame.blueTeam.participants,
                    true,
                    gameMetadata.blueTeamMetadata.participantMetadata,
                    championsUrlWithPatchVersion,
                )
                const redDeathIncreaseEvents = getDeathIncreaseToastEvents(
                    status.participants.red,
                    frame.redTeam.participants,
                    false,
                    gameMetadata.redTeamMetadata.participantMetadata,
                    championsUrlWithPatchVersion,
                )
                const blueDeathIncreaseCount = getTeamDeathIncreaseCount(status.participants.blue, frame.blueTeam.participants)
                const redDeathIncreaseCount = getTeamDeathIncreaseCount(status.participants.red, frame.redTeam.participants)
                const blueKillIncreaseCount = Math.max(0, currentTotalKills.blue - status.totalKills.blue)
                const redKillIncreaseCount = Math.max(0, currentTotalKills.red - status.totalKills.red)
                const inferredBlueExecutionCount = Math.max(0, blueDeathIncreaseCount - redKillIncreaseCount)
                const inferredRedExecutionCount = Math.max(0, redDeathIncreaseCount - blueKillIncreaseCount)
                const shouldShowExecutionToast = inferredBlueExecutionCount > 0 || inferredRedExecutionCount > 0

                if (shouldShowExecutionToast) {
                    toastQueue.push(...blueDeathIncreaseEvents.slice(0, inferredBlueExecutionCount))
                    toastQueue.push(...redDeathIncreaseEvents.slice(0, inferredRedExecutionCount))
                }
            }

            const blueTeamDeathsIncreased = hasAnyDeathIncrease(status.participants.blue, frame.blueTeam.participants)
            const redTeamDeathsIncreased = hasAnyDeathIncrease(status.participants.red, frame.redTeam.participants)
            const blueTeamAllDead = areAllParticipantsDead(frame.blueTeam.participants)
            const redTeamAllDead = areAllParticipantsDead(frame.redTeam.participants)

            const blueAceTriggered = redTeamDeathsIncreased && redTeamAllDead
            const redAceTriggered = blueTeamDeathsIncreased && blueTeamAllDead

            if (blueAceTriggered) {
                const blueKillToastEvent = toastQueue.find((toastEvent) => toastEvent.eventType === "kill" && toastEvent.blueTeam)
                if (blueKillToastEvent) {
                    blueKillToastEvent.sound = blue_ace.default
                }
            }

            if (redAceTriggered) {
                const redKillToastEvent = toastQueue.find((toastEvent) => toastEvent.eventType === "kill" && !toastEvent.blueTeam)
                if (redKillToastEvent) {
                    redKillToastEvent.sound = red_ace.default
                }
            }

            const shouldPlayFirstBlood =
                status.gameIndex === gameIndex
                && !firstBloodPlayedRef.current.played
                && totalKillsBefore === 0
                && totalKillsNow > 0
            if (shouldPlayFirstBlood) {
                const firstKillToastEvent = toastQueue.find((toastEvent) => (
                    toastEvent.eventType === "kill" && toastEvent.sound === kill.default
                ))
                if (firstKillToastEvent) {
                    firstKillToastEvent.sound = first_blood.default
                }
                firstBloodPlayedRef.current.played = true
            }

            const frameElapsedGameTimeSeconds = frameIndex === framesToProcess.length - 1
                ? elapsedGameTimeSeconds
                : status.elapsedGameTimeSeconds
            const shouldPlayWelcomeRift =
                status.gameIndex === gameIndex
                && !welcomeRiftPlayedRef.current.played
                && status.elapsedGameTimeSeconds === 0
                && frameElapsedGameTimeSeconds >= 1
            if (shouldPlayWelcomeRift) {
                welcomeRiftPlayedRef.current.played = true
            }

            if (!soundAlreadyPlaying && shouldPlayWelcomeRift) {
                playSound(welcome_rift.default)
                soundAlreadyPlaying = true
            }
            toastQueue.forEach((toastEvent) => {
                const didShowToast = createToast(toastEvent, soundAlreadyPlaying, debugShowAllDataEnabled, undefined, isBasicCompactLayout);
                if (didShowToast) {
                    soundAlreadyPlaying = true;
                }
            });

            status = buildStatusWatcher(frame, gameIndex, frameElapsedGameTimeSeconds, currentTotalKills)
        })

        statusRef.current = status
    }, [lastWindowFrame, gameIndex, elapsedGameTimeSeconds, gameMetadata.blueTeamMetadata.participantMetadata, gameMetadata.redTeamMetadata.participantMetadata, championsUrlWithPatchVersion, trueBlueTeam.image, trueRedTeam.image, debugShowAllDataEnabled, isBasicCompactLayout]);

    useEffect(() => {
        if (!debugShowAllDataEnabled) {
            toast.dismiss()
            DEBUG_PREVIEW_TOAST_IDS.forEach((toastId) => toast.dismiss(toastId))
            return
        }

        const bluePreviewChampionIcon = getChampionIconForParticipant(
            1,
            gameMetadata.blueTeamMetadata.participantMetadata,
            championsUrlWithPatchVersion,
        )
        const redPreviewChampionIcon = getChampionIconForParticipant(
            6,
            gameMetadata.redTeamMetadata.participantMetadata,
            championsUrlWithPatchVersion,
        )
        const bluePreviewAssistantIcons = [2, 3, 4, 5].map((participantId) => (
            getChampionIconForParticipant(
                participantId,
                gameMetadata.blueTeamMetadata.participantMetadata,
                championsUrlWithPatchVersion,
            )
        )).filter(Boolean)
        const redPreviewAssistantIcons = [7, 8, 9, 10].map((participantId) => (
            getChampionIconForParticipant(
                participantId,
                gameMetadata.redTeamMetadata.participantMetadata,
                championsUrlWithPatchVersion,
            )
        )).filter(Boolean)
        const previewToastEvents: Array<{ toastId: string, event: ToastEvent }> = [
            {
                toastId: DEBUG_PREVIEW_TOAST_IDS[0],
                event: {
                    blueTeam: true,
                    sound: dragon_blue.default,
                    message: `\uB4DC\uB798\uACE4 \uCC98\uCE58`,
                    image: trueBlueTeam.image,
                    diff: 0,
                },
            },
            {
                toastId: DEBUG_PREVIEW_TOAST_IDS[1],
                event: {
                    blueTeam: false,
                    sound: baron_red.default,
                    message: `\uBC14\uB860 \uCC98\uCE58`,
                    image: trueRedTeam.image,
                    diff: 0,
                },
            },
            {
                toastId: DEBUG_PREVIEW_TOAST_IDS[2],
                event: {
                    blueTeam: true,
                    sound: executed.default,
                    message: `\uCC98\uD615\uB418\uC5C8\uC2B5\uB2C8\uB2E4.`,
                    image: bluePreviewChampionIcon || redPreviewChampionIcon,
                    diff: 0,
                },
            },
            {
                toastId: DEBUG_PREVIEW_TOAST_IDS[3],
                event: {
                    blueTeam: true,
                    sound: kill.default,
                    eventType: `kill`,
                    killers: [bluePreviewChampionIcon].filter(Boolean),
                    assistants: bluePreviewAssistantIcons,
                    victims: [redPreviewChampionIcon].filter(Boolean),
                },
            },
            {
                toastId: DEBUG_PREVIEW_TOAST_IDS[4],
                event: {
                    blueTeam: false,
                    sound: kill.default,
                    eventType: `kill`,
                    killers: [redPreviewChampionIcon].filter(Boolean),
                    assistants: redPreviewAssistantIcons,
                    victims: [bluePreviewChampionIcon].filter(Boolean),
                },
            },
        ]

        let soundAlreadyPlaying = false
        previewToastEvents.forEach(({ toastId, event }) => {
            const didShowToast = createToast(event, soundAlreadyPlaying, true, toastId, isBasicCompactLayout)
            if (didShowToast) {
                soundAlreadyPlaying = true
            }
        })
    }, [
        debugShowAllDataEnabled,
        championsUrlWithPatchVersion,
        gameMetadata.blueTeamMetadata.participantMetadata,
        gameMetadata.redTeamMetadata.participantMetadata,
        trueBlueTeam.image,
        trueRedTeam.image,
        isBasicCompactLayout,
    ])

    const toastLayerClassName = `live-api-watcher-toast-layer${isBasicCompactLayout ? ` live-api-watcher-toast-layer-basic-compact` : ``}`

    return (
        <div className={toastLayerClassName} aria-hidden="true">
            <ToastContainer limit={10} />
        </div>
    );
}

function createToast(
    toastEvent: ToastEvent,
    soundIsPlaying: boolean,
    persistToast = false,
    forcedToastId?: string,
    isBasicCompactLayout = false,
) {
    const isKillToast = isKillToastEvent(toastEvent)
    const toastOptions: any = {
        pauseOnHover: false,
        pauseOnFocusLoss: false,
        position: isBasicCompactLayout
            ? toast.POSITION.TOP_CENTER
            : (toastEvent.blueTeam ? toast.POSITION.TOP_LEFT : toast.POSITION.TOP_RIGHT),
    }

    if (isBasicCompactLayout && isKillToast) {
        toastOptions.className = `toast-basic-compact-kill-row`
    }

    if (persistToast) {
        toastOptions.autoClose = false
        toastOptions.closeButton = true
        toastOptions.closeOnClick = false
        toastOptions.draggable = false
    }

    if (forcedToastId) {
        toastOptions.toastId = forcedToastId
    } else if (!isKillToast) {
        toastOptions.toastId = `${toastEvent.blueTeam}_${toastEvent.image || ""}_${toastEvent.message || ""}_${toastEvent.diff}`
    }

    if (toastOptions.toastId && toast.isActive(toastOptions.toastId)) {
        return false
    }

    if (!soundIsPlaying) {
        playSound(toastEvent.sound)
    }

    const content = isKillToast ? (
        <div className="toast-watcher toast-watcher-kill-feed">
            <div className="toast-kill-feed-icons toast-kill-feed-assistants">
                {toastEvent.assistants.map((image, index) => (
                    <img key={`assist_${index}_${image}`} className="toast-image toast-image-assister" src={image} alt="assist" />
                ))}
            </div>
            <div className="toast-kill-feed-icons toast-kill-feed-killers">
                {toastEvent.killers.map((image, index) => (
                    <img key={`killer_${index}_${image}`} className="toast-image toast-image-killer" src={image} alt="killer" />
                ))}
            </div>
            <KillFeedSVG className="toast-kill-feed-divider" />
            <div className="toast-kill-feed-icons toast-kill-feed-victims">
                {toastEvent.victims.map((image, index) => (
                    <img key={`victim_${index}_${image}`} className="toast-image toast-image-victim" src={image} alt="victim" />
                ))}
            </div>
        </div>
    ) : (
        <div className="toast-watcher">
            <div className="toast-image">
                <img src={toastEvent.image} alt={toastEvent.blueTeam ? "blue team" : "red team"} />
            </div>
            <h4 style={{ color: "#FFF" }}>{toastEvent.message}</h4>
        </div>
    )

    if (toastEvent.blueTeam) {
        toast.info(content, toastOptions)
    } else {
        toast.error(content, toastOptions)
    }
    return true
}

function isKillToastEvent(toastEvent: ToastEvent): toastEvent is ToastEvent & Required<Pick<ToastEvent, "assistants" | "killers" | "victims">> {
    return toastEvent.eventType === "kill"
        && Array.isArray(toastEvent.assistants)
        && Array.isArray(toastEvent.killers)
        && Array.isArray(toastEvent.victims)
}

function buildKillToastEvents(
    blueTeam: boolean,
    previousTeamParticipants: WindowParticipant[],
    nextTeamParticipants: WindowParticipant[],
    teamParticipantMetadata: GameMetadata["blueTeamMetadata"]["participantMetadata"],
    previousOpponentParticipants: WindowParticipant[],
    nextOpponentParticipants: WindowParticipant[],
    opponentParticipantMetadata: GameMetadata["blueTeamMetadata"]["participantMetadata"],
    championsUrlWithPatchVersion: string,
): ToastEvent[] {
    const killerEntries = getChampionDeltaEntries(
        previousTeamParticipants,
        nextTeamParticipants,
        teamParticipantMetadata,
        championsUrlWithPatchVersion,
        "kills",
    )
    const assistantEntries = getChampionDeltaEntries(
        previousTeamParticipants,
        nextTeamParticipants,
        teamParticipantMetadata,
        championsUrlWithPatchVersion,
        "assists",
    )
    const victimEntries = getChampionDeltaEntries(
        previousOpponentParticipants,
        nextOpponentParticipants,
        opponentParticipantMetadata,
        championsUrlWithPatchVersion,
        "deaths",
    )

    if (killerEntries.length === 0 || victimEntries.length === 0) {
        return []
    }

    const killers = killerEntries.map((entry) => entry.championIcon)
    const assistants = getOrderedAssistantIcons(killerEntries, assistantEntries)
    const victims = victimEntries.map((entry) => entry.championIcon)

    return [
        {
            blueTeam,
            sound: kill.default,
            eventType: "kill",
            assistants,
            killers,
            victims,
            diff: killers.length + victims.length,
        },
    ]
}

function getChampionDeltaEntries(
    previousParticipants: WindowParticipant[],
    nextParticipants: WindowParticipant[],
    participantMetadata: GameMetadata["blueTeamMetadata"]["participantMetadata"],
    championsUrlWithPatchVersion: string,
    deltaKey: "kills" | "assists" | "deaths",
): ParticipantDeltaEntry[] {
    const participantCount = Math.min(previousParticipants.length, nextParticipants.length)
    const deltaEntries: ParticipantDeltaEntry[] = []

    for (let i = 0; i < participantCount; i++) {
        const delta = Math.max(
            0,
            Number(nextParticipants[i][deltaKey] || 0) - Number(previousParticipants[i][deltaKey] || 0)
        )
        if (delta === 0) {
            continue
        }

        const participantId = Number(nextParticipants[i].participantId || previousParticipants[i].participantId)
        const championIcon = getChampionIconForParticipant(participantId, participantMetadata, championsUrlWithPatchVersion)
        if (!championIcon) {
            continue
        }

        deltaEntries.push({
            participantId,
            championIcon,
            delta,
        })
    }

    return deltaEntries
}

function getOrderedAssistantIcons(
    killerEntries: ParticipantDeltaEntry[],
    assistantEntries: ParticipantDeltaEntry[],
): string[] {
    if (assistantEntries.length === 0) {
        return []
    }

    const assistantParticipantIdsInOrder: number[] = []
    const assistantRemainingByParticipantId = new Map<number, number>()
    const assistantIconByParticipantId = new Map<number, string>()

    assistantEntries.forEach((entry) => {
        assistantParticipantIdsInOrder.push(entry.participantId)
        assistantRemainingByParticipantId.set(entry.participantId, entry.delta)
        assistantIconByParticipantId.set(entry.participantId, entry.championIcon)
    })

    const killerSequence: number[] = []
    killerEntries.forEach((entry) => {
        for (let count = 0; count < entry.delta; count++) {
            killerSequence.push(entry.participantId)
        }
    })

    const orderedUniqueAssistantParticipantIds: number[] = []
    const pushUniqueAssistantParticipantId = (participantId: number) => {
        if (!orderedUniqueAssistantParticipantIds.includes(participantId)) {
            orderedUniqueAssistantParticipantIds.push(participantId)
        }
    }

    killerSequence.forEach((killerParticipantId) => {
        const selectedAssistantParticipantId = selectAssistantParticipantIdForKiller(
            killerParticipantId,
            assistantParticipantIdsInOrder,
            assistantRemainingByParticipantId,
        )
        if (selectedAssistantParticipantId === null) {
            return
        }

        const remainingCount = assistantRemainingByParticipantId.get(selectedAssistantParticipantId) || 0
        if (remainingCount <= 0) {
            return
        }

        assistantRemainingByParticipantId.set(selectedAssistantParticipantId, remainingCount - 1)
        pushUniqueAssistantParticipantId(selectedAssistantParticipantId)
    })

    assistantParticipantIdsInOrder.forEach((participantId) => {
        const remainingCount = assistantRemainingByParticipantId.get(participantId) || 0
        if (remainingCount > 0) {
            pushUniqueAssistantParticipantId(participantId)
        }
    })

    return orderedUniqueAssistantParticipantIds
        .map((participantId) => assistantIconByParticipantId.get(participantId) || "")
        .filter((icon) => icon.length > 0)
}

function selectAssistantParticipantIdForKiller(
    killerParticipantId: number,
    assistantParticipantIdsInOrder: number[],
    assistantRemainingByParticipantId: Map<number, number>,
): number | null {
    let selectedParticipantId: number | null = null
    let maxRemainingCount = -1

    for (const participantId of assistantParticipantIdsInOrder) {
        if (participantId === killerParticipantId) {
            continue
        }

        const remainingCount = assistantRemainingByParticipantId.get(participantId) || 0
        if (remainingCount <= 0) {
            continue
        }

        if (remainingCount > maxRemainingCount) {
            selectedParticipantId = participantId
            maxRemainingCount = remainingCount
        }
    }

    if (selectedParticipantId !== null) {
        return selectedParticipantId
    }

    for (const participantId of assistantParticipantIdsInOrder) {
        const remainingCount = assistantRemainingByParticipantId.get(participantId) || 0
        if (remainingCount > 0) {
            return participantId
        }
    }

    return null
}

function getChampionIconForParticipant(
    participantId: number,
    participantMetadata: GameMetadata["blueTeamMetadata"]["participantMetadata"],
    championsUrlWithPatchVersion: string,
): string {
    const matchedMetadata = participantMetadata.find((metadata) => Number(metadata.participantId) === Number(participantId))
    const fallbackMetadata = matchedMetadata || participantMetadata[0]
    if (!fallbackMetadata) {
        return ""
    }
    return `${championsUrlWithPatchVersion}${fallbackMetadata.championId}.png`
}

function playSound(sound: string) {
    let audio = new Audio(sound);
    audio.load();
    audio.volume = 0.20;
    audio.play();
}

function hasAnyDeathIncrease(previousParticipants: WindowParticipant[], nextParticipants: WindowParticipant[]) {
    const participantCount = Math.min(previousParticipants.length, nextParticipants.length)
    for (let i = 0; i < participantCount; i++) {
        if (nextParticipants[i].deaths > previousParticipants[i].deaths) {
            return true
        }
    }
    return false
}

function getTeamDeathIncreaseCount(previousParticipants: WindowParticipant[], nextParticipants: WindowParticipant[]) {
    const participantCount = Math.min(previousParticipants.length, nextParticipants.length)
    let deathIncreaseCount = 0
    for (let i = 0; i < participantCount; i++) {
        deathIncreaseCount += Math.max(0, Number(nextParticipants[i].deaths || 0) - Number(previousParticipants[i].deaths || 0))
    }
    return deathIncreaseCount
}

function getDeathIncreaseToastEvents(
    previousParticipants: WindowParticipant[],
    nextParticipants: WindowParticipant[],
    blueTeam: boolean,
    participantMetadata: GameMetadata["blueTeamMetadata"]["participantMetadata"],
    championsUrlWithPatchVersion: string,
): ToastEvent[] {
    const participantCount = Math.min(previousParticipants.length, nextParticipants.length)
    const toastEvents: ToastEvent[] = []
    for (let i = 0; i < participantCount; i++) {
        const deathIncreaseCount = Math.max(0, Number(nextParticipants[i].deaths || 0) - Number(previousParticipants[i].deaths || 0))
        for (let deathIndex = 0; deathIndex < deathIncreaseCount; deathIndex++) {
            toastEvents.push({
                blueTeam,
                sound: executed.default,
                message: `\uCC98\uD615\uB418\uC5C8\uC2B5\uB2C8\uB2E4.`,
                image: getChampionIconForParticipant(nextParticipants[i].participantId, participantMetadata, championsUrlWithPatchVersion),
                diff: deathIndex,
            })
        }
    }
    return toastEvents
}

function areAllParticipantsDead(participants: WindowParticipant[]) {
    if (!participants || participants.length === 0) return false
    return participants.every((participant) => Number(participant.currentHealth) <= 0)
}

function buildStatusWatcher(
    windowFrame: WindowFrame,
    gameIndex: number,
    elapsedGameTimeSeconds: number,
    totalKills?: { blue: number, red: number },
): StatusWatcher {
    const resolvedTotalKills = totalKills || {
        blue: getTeamKillCountFromParticipants(windowFrame.blueTeam.participants),
        red: getTeamKillCountFromParticipants(windowFrame.redTeam.participants),
    }

    return {
        rfc460Timestamp: windowFrame.rfc460Timestamp,
        elapsedGameTimeSeconds,
        totalKills: resolvedTotalKills,
        dragons: { blue: windowFrame.blueTeam.dragons.length, red: windowFrame.redTeam.dragons.length },
        gameIndex,
        inhibitors: { blue: windowFrame.blueTeam.inhibitors, red: windowFrame.redTeam.inhibitors },
        towers: { blue: windowFrame.blueTeam.towers, red: windowFrame.redTeam.towers },
        barons: { blue: windowFrame.blueTeam.barons, red: windowFrame.redTeam.barons },
        participants: { blue: windowFrame.blueTeam.participants, red: windowFrame.redTeam.participants },
    }
}

function getTeamKillCountFromParticipants(participants: WindowParticipant[] | undefined) {
    if (!Array.isArray(participants)) return 0
    return participants.reduce((sum, participant) => sum + Number(participant.kills || 0), 0)
}

function getTimestampValue(timestamp: string | Date | undefined) {
    if (!timestamp) return 0
    const value = new Date(timestamp).getTime()
    return Number.isFinite(value) ? value : 0
}





