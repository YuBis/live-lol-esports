import './styles/playerStatusStyle.css'
import '../Schedule/styles/scheduleStyle.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { getWindowResponse } from '../../utils/LoLEsportsAPI'
import { CustomTeam, EventDetails, Team, WindowFrame } from '../types/baseTypes'

type Props = {
    eventDetails: EventDetails,
    gameIndex: number
}

type WinnerLabelByGameId = Record<string, string>
type WinnerSide = CustomTeam['side']

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
                    const displayLabel = game.state.toLowerCase() === `completed` && winnerLabel
                        ? winnerLabel
                        : formatGameStateLabel(game.state)

                    return <Link className={`game-selector-item ${game.state} ${gameIndex === game.number ? `selected` : ``}`} to={`/live/${eventDetails.id}/game-index/${game.number}`} key={`game-selector-${game.id}`}>
                        <span className={`#/live/${game.state}`}>Game {game.number} - {displayLabel}</span>
                    </Link>
                })}

            </div>) : null
    )
}

function formatGameStateLabel(state: string): string {
    const normalizedState = state.toLowerCase()
    if (normalizedState === `completed`) return `\uC885\uB8CC`
    if (normalizedState === `inprogress`) return `\uC9C4\uD589 \uC911`
    if (normalizedState === `unstarted`) return `\uC608\uC815`
    if (normalizedState === `unneeded`) return `\uBBF8\uC9C4\uD589`
    return state
}

async function getWinnerTeamIdForGame(gameId: string, gameTeams: CustomTeam[]): Promise<string | undefined> {
    try {
        const response = await getWindowResponse(gameId)
        if (!response || !response.data) return undefined

        const frames = response.data.frames as WindowFrame[] | undefined
        if (!frames || frames.length === 0) return undefined

        const lastWindowFrame = frames[frames.length - 1]
        const winnerSide = inferWinnerSide(lastWindowFrame)
        if (!winnerSide) return undefined

        return gameTeams.find((team) => team.side === winnerSide)?.id
    } catch (error) {
        console.error(error)
        return undefined
    }
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
