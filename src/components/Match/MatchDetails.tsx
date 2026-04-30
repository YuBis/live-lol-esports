import './styles/playerStatusStyle.css'
import '../Schedule/styles/scheduleStyle.css'

import { EventDetails, GameMetadata, Record, Result, ScheduleEvent } from "../types/baseTypes";

type Props = {
    gameMetadata: GameMetadata,
    eventDetails: EventDetails,
    matchState: string,
    records?: Record[],
    results?: Result[],
    scheduleEvent: ScheduleEvent,
}

export function MatchDetails({ gameMetadata, eventDetails, matchState, records, results, scheduleEvent }: Props) {
    let blueTeam = eventDetails.match.teams[0];
    let redTeam = eventDetails.match.teams[1];

    const auxBlueTeam = blueTeam

    /*
        As vezes os times continuam errados mesmo apos verificar o ultimo frame,
        em ligas como TCL, por isso fazemos essa verificação pelo nome
    */
    const summonerName = gameMetadata.blueTeamMetadata.participantMetadata[0].summonerName.split(" ");

    if (redTeam.code.startsWith(summonerName[0])) { // Temos que verificar apenas os primeiros caracteres pois os times academy usam o A, a mais na tag mas não nos nomes
        blueTeam = redTeam;
        redTeam = auxBlueTeam;
    }

    let matchResults = results || eventDetails.match.teams.map(team => team.result)

    return (
        <div className="">
            <div className="status-live-game-card-content">
                {eventDetails ? (<h3>{eventDetails.league.name} - {scheduleEvent.blockName}  - Best of {eventDetails.match.strategy.count}</h3>) : null}
                <h3>{new Date(scheduleEvent.startTime).toLocaleTimeString([], { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</h3>
                <div className="live-game-stats-header">
                    <div className="live-game-stats-header-team-images">
                        {TeamCard({ eventDetails, index: 0, matchResults, record: records ? records[0] : undefined })}
                        <h1>
                            <div>Match {matchState}</div>
                            {matchResults ? (<div>{matchResults[0].gameWins}-{matchResults[1].gameWins}</div>) : null}
                            VS
                        </h1>
                        {TeamCard({ eventDetails, index: 1, matchResults, record: records ? records[1] : undefined })}
                    </div>
                </div>
            </div>
        </div>
    );
}

type TeamCardProps = {
    eventDetails: EventDetails,
    index: number,
    matchResults?: Result[],
    record?: Record,
}

function TeamCard({ eventDetails, index, matchResults, record }: TeamCardProps) {
    return (
        <h1>
            <div className="live-game-card-team">
                <img className="live-game-card-team-image" src={eventDetails.match.teams[index].image}
                    alt={eventDetails?.match.teams[index].name} />
                <span>
                    <h4>
                        {eventDetails.match.teams[index].name}
                    </h4>
                </span>
                <span className='outcome'>
                    {matchResults ? (<p className={matchResults[index].outcome}>
                        {matchResults[index].outcome}
                    </p>) : null}
                </span>
                {record ?
                    (<span>
                        <p>
                            {record.wins} - {record.losses}
                        </p>
                    </span>)
                    : null}
            </div>
        </h1>
    )
}
