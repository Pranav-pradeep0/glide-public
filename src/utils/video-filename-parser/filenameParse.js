import { parseAudioChannels } from './audioChannels.js';
import { parseAudioCodec } from './audioCodec.js';
import { isComplete } from './complete.js';
import { parseEdition } from './edition.js';
import { parseGroup } from './group.js';
import { isMulti, parseLanguage } from './language.js';
import { parseQuality } from './quality.js';
import { parseSeason } from './season.js';
import { parseTitleAndYear } from './title.js';
import { removeEmpty } from './utils.js';
import { parseVideoCodec } from './videoCodec.js';
/**
 * @param name release / file name
 * @param isTV
 */
export function filenameParse(name, isTv = false) {
    let title = '';
    let year = null;
    if (!isTv) {
        const titleAndYear = parseTitleAndYear(name);
        title = titleAndYear.title;
        year = titleAndYear.year;
    }
    const edition = parseEdition(name);
    const { codec: videoCodec } = parseVideoCodec(name);
    const { codec: audioCodec } = parseAudioCodec(name);
    const { channels: audioChannels } = parseAudioChannels(name);
    const group = parseGroup(name);
    const languages = parseLanguage(name);
    const quality = parseQuality(name);
    const multi = isMulti(name);
    const complete = isComplete(name);
    const result = {
        title,
        year,
        resolution: quality.resolution,
        sources: quality.sources,
        videoCodec,
        audioCodec,
        audioChannels,
        revision: quality.revision,
        group,
        edition,
        languages,
        multi,
        complete,
    };
    if (isTv) {
        const season = parseSeason(name);
        if (season !== null) {
            const seasonResult = {
                seasons: season.seasons,
                episodeNumbers: season.episodeNumbers,
                airDate: season.airDate,
                fullSeason: season.fullSeason,
                isPartialSeason: season.isPartialSeason,
                isMultiSeason: season.isMultiSeason,
                isSeasonExtra: season.isSeasonExtra,
                isSpecial: season.isSpecial,
                seasonPart: season.seasonPart,
            };
            return {
                ...result,
                title: season.seriesTitle ?? title,
                ...seasonResult,
                isTv: true,
            };
        }
    }
    return removeEmpty(result);
}
