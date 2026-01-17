import { type Channels } from './audioChannels.js';
import { type AudioCodec } from './audioCodec.js';
import { type Edition } from './edition.js';
import { type Language } from './language.js';
import { type Revision } from './quality.js';
import type { Resolution } from './resolution.js';
import { type Season } from './season.js';
import type { Source } from './source.js';
import { type VideoCodec } from './videoCodec.js';
type ParsedTvInfo = Omit<Season, 'releaseTitle' | 'seriesTitle'>;
interface BaseParsed {
    title: string;
    year: string | null;
    edition: Edition;
    resolution?: Resolution;
    sources: Source[];
    videoCodec?: VideoCodec;
    audioCodec?: AudioCodec;
    audioChannels?: Channels;
    group: string | null;
    revision: Revision;
    languages: Language[];
    multi?: boolean;
    complete?: boolean;
    /**
     * Added locally to fix TS union access issue
     */
    isTv?: boolean;
}
export type ParsedMovie = BaseParsed;
export type ParsedShow = ParsedTvInfo & BaseParsed & {
    isTv: true;
};
export type ParsedFilename = ParsedMovie | ParsedShow;
/**
 * @param name release / file name
 * @param isTV
 */
export declare function filenameParse(name: string, isTv?: boolean): ParsedFilename;
export { };
