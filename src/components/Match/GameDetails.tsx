import './styles/playerStatusStyle.css'
import '../Schedule/styles/scheduleStyle.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { getISODateMultiplyOf10, getWindowResponse } from '../../utils/LoLEsportsAPI'
import { CustomTeam, EventDetails, ExtendedGame, Team, WindowFrame } from '../types/baseTypes'

type Props = {
    eventDetails: EventDetails,
    gameIndex: number
}

type WinnerLabelByGameId = Record<string, string>
type WinnerSide = CustomTeam['side']
const LIVE_STATS_STARTING_TIME_STEP_MS = 10 * 1000
const COMPLETED_GAME_TAIL_LOOKAHEAD_MS = 4 * 60 * 60 * 1000
const COMPLETED_GAME_TAIL_SAFE_NOW_OFFSET_MS = 60 * 1000

export function GameDetails({ eventDetails, gameIndex }: Props) {
    const [winnerLabelByGameId, setWinnerLabelByGameId] = useState<WinnerLabelByGameId>({})
    const requestTokenRef = useRef<number>(0)
    const teamsById = useMemo(() => {
        const teamMap = new Map<string, Team>()
        eventDetails.match.teams.forEach((team) => {
            teamMap.set(team.id, team)
        })
        return teamMap
    }, [eventDetails.match.teams])

    useEffect(() => {
        const completedGames = eventDetails.match.games.filter((game) => game.state.toLowerCase() === `completed`)
        const requestToken = requestTokenRef.current + 1
        requestTokenRef.current = requestToken
        let isCancelled = false

        if (completedGames.length === 0) {
            setWinnerLabelByGameId({})
            return () => {
                isCancelled = true
            }
        }

        void Promise.all(completedGames.map(async (game) => {
            const winnerTeamId = await getWinnerTeamIdForGame(game.id, game.teams)
            if (!winnerTeamId) {
                return { gameId: game.id, winnerLabel: `` }
            }
            const winnerTeam = teamsById.get(winnerTeamId)
            const winnerLabel = winnerTeam?.code || winnerTeam?.name || ``
            return { gameId: game.id, winnerLabel }
        })).then((winnerEntries) => {
            if (isCancelled || requestTokenRef.current !== requestToken) return

            const nextWinnerLabelByGameId: WinnerLabelByGameId = {}
            winnerEntries.forEach((entry) => {
                if (!entry.winnerLabel) return
                nextWinnerLabelByGameId[entry.gameId] = entry.winnerLabel
            })

            setWinnerLabelByGameId(nextWinnerLabelByGameId)
        })

        return () => {
            isCancelled = true
        }
    }, [eventDetails.match.games, teamsById])

    return (
        (eventDetails.match.games.length > 1) ? (
            <div className='game-selector'>
                {eventDetails.match.games.map((game) => {
                    const winnerLabel = winnerLabelByGameId[game.id]
                        || getFallbackWinnerLabelForCompletedGame(game, eventDetails, teamsById)
                    const displayLabel = formatGameStateLabel(game.state, winnerLabel)

                    return <Link className={`game-selector-item ${game.state} ${gameIndex === game.number ? `selected` : ``}`} to={`/live/${eventDetails.id}/game-index/${game.number}`} key={`game-selector-${game.id}`}>
                        <span className={`#/live/${game.state}`}>Game {game.number} - {displayLabel}</span>
                    </Link>
                })}

            </div>) : null
    )
}

function formatGameStateLabel(state: string, winnerLabel?: string): string {
    const normalizedState = state.toLowerCase()
    if (normalizedState === `completed`) return winnerLabel || `\uC885\uB8CC`
    if (normalizedState === `inprogress`) return `\uC9C4\uD589 \uC911`
    if (normalizedState === `unstarted`) return `\uC608\uC815`
    if (normalizedState === `unneeded`) return `\uBBF8\uC9C4\uD589`
    return state
}

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

function getFallbackWinnerLabelForCompletedGame(
    game: ExtendedGame,
    eventDetails: EventDetails,
    teamsById: Map<string, Team>,
) {
    if (game.state.toLowerCase() !== `completed`) return undefined

    const outcomeWinnerTeamId = getWinnerTeamIdFromGameOutcome(game.teams)
    if (outcomeWinnerTeamId) {
        return getTeamLabelById(teamsById, outcomeWinnerTeamId)
    }

    const seriesWinnerTeamId = getSeriesWinnerTeamId(eventDetails.match.teams)
    if (!seriesWinnerTeamId) return undefined

    const completedGames = eventDetails.match.games.filter((seriesGame) => seriesGame.state.toLowerCase() === `completed`)
    const completedGameCount = completedGames.length
    if (completedGameCount === 0) return undefined

    const leadingTeamWins = Math.max(
        Number(eventDetails.match.teams[0]?.result?.gameWins || 0),
        Number(eventDetails.match.teams[1]?.result?.gameWins || 0),
    )
    const trailingTeamWins = Math.min(
        Number(eventDetails.match.teams[0]?.result?.gameWins || 0),
        Number(eventDetails.match.teams[1]?.result?.gameWins || 0),
    )

    if (trailingTeamWins === 0 && completedGameCount === leadingTeamWins) {
        return getTeamLabelById(teamsById, seriesWinnerTeamId)
    }

    const seriesIsFinished = eventDetails.match.games.every((seriesGame) => {
        const normalizedState = seriesGame.state.toLowerCase()
        return normalizedState === `completed` || normalizedState === `unneeded`
    })

    if (!seriesIsFinished) return undefined

    const lastCompletedGameNumber = completedGames.reduce((maxNumber, seriesGame) => Math.max(maxNumber, seriesGame.number), 0)
    if (game.number !== lastCompletedGameNumber) return undefined

    return getTeamLabelById(teamsById, seriesWinnerTeamId)
}

function getWinnerTeamIdFromGameOutcome(gameTeams: CustomTeam[]): string | undefined {
    const winnerTeam = (gameTeams as Array<CustomTeam & { outcome?: string, result?: { outcome?: string } }>).find((team) => {
        const normalizedTeamOutcome = team.outcome?.toLowerCase()
        const normalizedResultOutcome = team.result?.outcome?.toLowerCase()
        return normalizedTeamOutcome === `win` || normalizedResultOutcome === `win`
    })
    return winnerTeam?.id
}

function getSeriesWinnerTeamId(matchTeams: Team[]): string | undefined {
    if (matchTeams.length < 2) return undefined

    const firstTeamWins = Number(matchTeams[0]?.result?.gameWins || 0)
    const secondTeamWins = Number(matchTeams[1]?.result?.gameWins || 0)

    if (firstTeamWins === secondTeamWins) return undefined
    return firstTeamWins > secondTeamWins ? matchTeams[0].id : matchTeams[1].id
}

function getTeamLabelById(teamsById: Map<string, Team>, teamId: string) {
    const team = teamsById.get(teamId)
    return team?.code || team?.name || undefined
}

function inferWinnerSide(lastWindowFrame: WindowFrame): WinnerSide | undefined {
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
        Math.min(fourHoursAfterStartTimestampValue, safeNowTimestampValue)
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
