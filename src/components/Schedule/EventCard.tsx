import {Link} from "react-router-dom";
import {ReactComponent as TeamTBDSVG} from '../../assets/images/team-tbd.svg';

import {ScheduleEvent} from "../types/baseTypes";

type Props = {
    scheduleEvent: ScheduleEvent;
    leagueLogoUrl?: string;
}

export function EventCard({ scheduleEvent, leagueLogoUrl }: Props) {
    return (
        <Link to={`live/${scheduleEvent.match.id}`}>
            <div className="live-game-card">
                <h3 className="live-game-card-league-title">
                    {leagueLogoUrl ? (
                        <img className="live-game-card-league-logo" src={leagueLogoUrl} alt={`${scheduleEvent.league.name} logo`} />
                    ) : null}
                    <span>{scheduleEvent.league.name} - {scheduleEvent.blockName}</span>
                </h3>
                <h4>
                    <span>
                        {new Date(scheduleEvent.startTime).toLocaleTimeString([], {year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit'})}
                    </span>
                </h4>
                <div className="live-game-card-content">
                    <div className="live-game-card-team">
                        {scheduleEvent.match.teams[0].code === "TBD" ? (<TeamTBDSVG className="live-game-card-team-image"/>) : (<img className="live-game-card-team-image" src={scheduleEvent.match.teams[0].image} alt={scheduleEvent.match.teams[0].name}/>) }
                        <span>
                            <h4>
                                {scheduleEvent.match.teams[0].name}
                            </h4>
                        </span>
                        <span className="outcome">
                            <p className={scheduleEvent.match.teams[0].result ? scheduleEvent.match.teams[0].result.outcome : ''}>
                                {scheduleEvent.match.teams[0].result ? scheduleEvent.match.teams[0].result.outcome : null}
                            </p>
                        </span>
                        <span>
                            <p>
                                {scheduleEvent.match.teams[0].record ? `${scheduleEvent.match.teams[0].record.wins} - ${scheduleEvent.match.teams[0].record.losses}` : null}
                            </p>
                        </span>
                    </div>

                    <div className="game-card-versus">
                        <span>BEST OF {scheduleEvent.match.strategy.count}</span>
                        <span>
                            <p>
                                {scheduleEvent.match.teams[0].result && scheduleEvent.match.teams[1].result ? `${scheduleEvent.match.teams[0].result.gameWins} - ${scheduleEvent.match.teams[1].result.gameWins}` : null}
                            </p>
                        </span>
                        <h1>VS</h1>
                    </div>

                    <div className="live-game-card-team">
                        {scheduleEvent.match.teams[1].code === "TBD" ? (<TeamTBDSVG className="live-game-card-team-image"/>) : (<img className="live-game-card-team-image" src={scheduleEvent.match.teams[1].image} alt={scheduleEvent.match.teams[1].name}/>) }
                        <span>
                            <h4>
                                {scheduleEvent.match.teams[1].name}
                            </h4>
                        </span>
                        <span className="outcome">
                            <p className={scheduleEvent.match.teams[1].result ? scheduleEvent.match.teams[1].result.outcome : ''}>
                                {scheduleEvent.match.teams[1].result ? scheduleEvent.match.teams[1].result.outcome : null}
                            </p>
                        </span>
                        <span>
                            <p>
                                {scheduleEvent.match.teams[1].record ? `${scheduleEvent.match.teams[1].record.wins} - ${scheduleEvent.match.teams[1].record.losses}` : null}
                            </p>
                        </span>
                    </div>
                </div>
            </div>
        </Link>
    );
}
