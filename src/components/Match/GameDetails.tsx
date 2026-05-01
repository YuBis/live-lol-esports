import './styles/playerStatusStyle.css'
import '../Schedule/styles/scheduleStyle.css'
import { Link } from 'react-router-dom'

import { EventDetails } from "../types/baseTypes";

type Props = {
    eventDetails: EventDetails,
    gameIndex: number
}

export function GameDetails({ eventDetails, gameIndex }: Props) {
    return (
        (eventDetails.match.games.length > 1) ? (
            <div className='game-selector'>
                {eventDetails.match.games.map((game) => {
                    return <Link className={`game-selector-item ${game.state} ${gameIndex === game.number ? `selected` : ``}`} to={`/live/${eventDetails.id}/game-index/${game.number}`} key={`game-selector-${game.id}`}>
                        <span className={`#/live/${game.state}`}>Game {game.number} - {capitalizeFirstLetter(game.state)}</span>
                    </Link>
                })}

            </div>) : null
    )
}

function capitalizeFirstLetter(string: string): string {
    return string.charAt(0).toUpperCase() + string.slice(1);
}
