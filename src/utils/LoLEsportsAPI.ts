import axios from "axios";

//export const ITEMS_URL = "https://ddragon.leagueoflegends.com/cdn/14.3.1/img/item/"
// export const CHAMPIONS_URL = "https://ddragon.bangingheads.net/cdn/14.3.1/img/champion/"
// const ITEMS_JSON_URL = `https://ddragon.leagueoflegends.com/cdn/14.3.1/data/en_US/item.json`
export const ITEMS_URL = "https://ddragon.leagueoflegends.com/cdn/PATCH_VERSION/img/item/"
export const CHAMPIONS_URL = "https://ddragon.leagueoflegends.com/cdn/PATCH_VERSION/img/champion/"
export const CHAMPIONS_JSON_URL = "https://ddragon.leagueoflegends.com/cdn/PATCH_VERSION/data/ko_KR/champion.json"
export const RUNES_JSON_URL = "https://ddragon.leagueoflegends.com/cdn/PATCH_VERSION/data/ko_KR/runesReforged.json"
export const ITEMS_JSON_URL = `https://ddragon.leagueoflegends.com/cdn/PATCH_VERSION/data/ko_KR/item.json`

const API_URL_PERSISTED = "https://esports-api.lolesports.com/persisted/gw"
const API_URL_LIVE = "https://feed.lolesports.com/livestats/v1"
const API_KEY = "0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z"

const DEFAULT_LIVE_DETAILS_DELAY_SECONDS = 20
const MIN_LIVE_DETAILS_DELAY_SECONDS = 10
const MAX_LIVE_DETAILS_DELAY_SECONDS = 240
const SUCCESSFUL_REQUESTS_BEFORE_DELAY_DECREASE = 120

let secondDelay = DEFAULT_LIVE_DETAILS_DELAY_SECONDS
let count = 0
let failureCount = 0
const LIVE_STATS_STARTING_TIME_STEP_SECONDS = 10

export function getScheduleResponse() {
    return axios.get(`${API_URL_PERSISTED}/getSchedule?hl=en-US`, {
        headers: {
            "x-api-key": API_KEY,
        },
    })
}

export function getWindowResponse(gameId: string, date?: string) {
    return axios.get(`${API_URL_LIVE}/window/${gameId}`, {
        params: {
            "startingTime": date,
        },
        headers: {
        },
    }).catch(function (error) {
        if (error.response) {
            // Request made and server responded
            console.error(error.response.data);
            //   console.error(error.response.headers);
        } else if (error.request) {
            // The request was made but no response was received
            console.error(error.request);
        } else {
            // Something happened in setting up the request that triggered an Error
            console.error('Error', error.message);
        }
    })
}

export function getGameDetailsResponse(gameId: string, date: string, lastFrameSuccess: boolean) {
    count++
    if (count % SUCCESSFUL_REQUESTS_BEFORE_DELAY_DECREASE === 0 && lastFrameSuccess) {
        secondDelay = Math.max(MIN_LIVE_DETAILS_DELAY_SECONDS, secondDelay - 10)
    }
    if (lastFrameSuccess) {
        failureCount = 0
    } else {
        failureCount++
    }
    return axios.get(`${API_URL_LIVE}/details/${gameId}`, {
        params: {
            "startingTime": date,
        },
        headers: {
        },
    }).catch(function (error) {
        if (error.response) {
            // Request made and server responded
            console.error(error.response.data);
            if (!error.response.data.message.includes(`window with end time less than`) || failureCount < 6) return
            count = 0
            failureCount = 0
            secondDelay = Math.min(MAX_LIVE_DETAILS_DELAY_SECONDS, secondDelay + 10)
        } else if (error.request) {
            // The request was made but no response was received
            console.error(error.request);
        } else {
            // Something happened in setting up the request that triggered an Error
            console.error('Error', error.message);
        }
    })
}

export function getGameDetailsSnapshotResponse(gameId: string, date: string) {
    return axios.get(`${API_URL_LIVE}/details/${gameId}`, {
        params: {
            "startingTime": date,
        },
        headers: {
        },
    }).catch(function (error) {
        if (error.response) {
            console.error(error.response.data);
        } else if (error.request) {
            console.error(error.request);
        } else {
            console.error('Error', error.message);
        }
    })
}

export function getEventDetailsResponse(gameId: string) {
    return axios.get(`${API_URL_PERSISTED}/getEventDetails`, {
        params: {
            "hl": "en-US",
            "id": gameId,
        },
        headers: {
            "x-api-key": API_KEY,
        },
    })
}

export function getStandingsResponse(tournamentId: string) {
    return axios.get(`${API_URL_PERSISTED}/getStandings`, {
        params: {
            "hl": "en-US",
            "tournamentId": tournamentId,
        },
        headers: {
            "x-api-key": API_KEY,
        },
    })
}

export function getLeaguesResponse() {
    return axios.get(`${API_URL_PERSISTED}/getLeagues`, {
        params: {
            "hl": "en-US",
        },
        headers: {
            "x-api-key": API_KEY,
        },
    })
}

export function getTournamentsForLeagueResponse(leagueId: string) {
    return axios.get(`${API_URL_PERSISTED}/getTournamentsForLeague`, {
        params: {
            "hl": "en-US",
            "leagueId": leagueId,
        },
        headers: {
            "x-api-key": API_KEY,
        },
    })
}

export function getDataDragonResponse(JSON_URL: string, formattedPatchVersion: string) {
    return axios.get(JSON_URL.replace(`PATCH_VERSION`, formattedPatchVersion))
}


export function getISODateMultiplyOf10() {
    const date = new Date();
    date.setMilliseconds(0);

    if (date.getSeconds() % LIVE_STATS_STARTING_TIME_STEP_SECONDS !== 0) {
        date.setSeconds(date.getSeconds() - (date.getSeconds() % LIVE_STATS_STARTING_TIME_STEP_SECONDS));
    }

    const boundedDelaySeconds = Math.max(MIN_LIVE_DETAILS_DELAY_SECONDS, Math.min(MAX_LIVE_DETAILS_DELAY_SECONDS, secondDelay))
    date.setSeconds(date.getSeconds() - boundedDelaySeconds);

    return date.toISOString();
}

// Backward-compatible alias for older imports/usages.
export function getISODateMultiplyOf5() {
    return getISODateMultiplyOf10()
}

export function getFormattedPatchVersion(patchVersion: string) {
    return patchVersion.split(`.`).slice(0, 2).join(`.`) + `.1`
}
