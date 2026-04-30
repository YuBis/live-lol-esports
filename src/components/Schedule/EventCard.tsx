import {Link} from "react-router-dom";
import {ReactComponent as TeamTBDSVG} from '../../assets/images/team-tbd.svg';

import {ScheduleEvent} from "../types/baseTypes";

type Props = {
    scheduleEvent: ScheduleEvent;
    leagueLogoUrl?: string;
}

export function EventCard({ scheduleEvent, leagueLogoUrl }: Props) {
    const blueWins = scheduleEvent.match.teams[0].result ? scheduleEvent.match.teams[0].result.gameWins : 0
    const redWins = scheduleEvent.match.teams[1].result ? scheduleEvent.match.teams[1].result.gameWins : 0
    const bestOfCount = scheduleEvent.match.strategy.count
    const status = getEventCardStatus(scheduleEvent)
    const progressSegments = getSeriesProgressSegments(bestOfCount, blueWins, redWins)

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
        return { label: "UPCOMING", className: "upcoming" }
    }
    if (scheduleEvent.state === "inProgress" || isLiveBySeries(scheduleEvent)) {
        return { label: "LIVE", className: "live" }
    }
    if (hasMatchOutcome(scheduleEvent) || scheduleEvent.state === "completed") {
        return { label: "FINAL", className: "final" }
    }
    return { label: "UPCOMING", className: "upcoming" }
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
