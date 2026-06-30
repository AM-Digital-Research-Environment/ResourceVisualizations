<?php
declare(strict_types=1);

namespace DreVisualizations\Precompute\Aggregators;

/**
 * Media-document charts: the episode-length histogram and the transcript word
 * cloud for the Podcasts dashboard (and reusable by any text-bearing corpus).
 *
 * Composed into {@see \DreVisualizations\Precompute\Aggregators}; its methods
 * reach shared constants and helpers on that class through `self::`.
 */
trait MediaChartsTrait
{
    /**
     * Episode-length histogram from a list of durations in seconds. Returns the
     * populated length bands in natural order (so the front-end buildHistogram
     * renders them left → right), as `[{name, value}]`; null when nothing is
     * countable. Empty bands are dropped to keep the columns tidy.
     *
     * @param list<int> $secondsList
     * @return list<array{name:string,value:int}>|null
     */
    public static function buildDurationHistogram(array $secondsList): ?array
    {
        // Upper bound (exclusive) of each band, in seconds; the last catches the rest.
        $bands = [
            ['name' => 'Under 20 min', 'max' => 20 * 60],
            ['name' => '20–30 min',    'max' => 30 * 60],
            ['name' => '30–40 min',    'max' => 40 * 60],
            ['name' => '40–50 min',    'max' => 50 * 60],
            ['name' => '50–60 min',    'max' => 60 * 60],
            ['name' => '60 min +',     'max' => PHP_INT_MAX],
        ];
        $counts = array_fill(0, count($bands), 0);
        $any = false;
        foreach ($secondsList as $s) {
            $s = (int) $s;
            if ($s <= 0) {
                continue;
            }
            foreach ($bands as $i => $band) {
                if ($s < $band['max']) {
                    $counts[$i]++;
                    $any = true;
                    break;
                }
            }
        }
        if (!$any) {
            return null;
        }
        $out = [];
        foreach ($bands as $i => $band) {
            if ($counts[$i] > 0) {
                $out[] = ['name' => $band['name'], 'value' => $counts[$i]];
            }
        }
        return $out;
    }

    /**
     * Word-frequency cloud across a set of (plain-text) transcripts. Aggressive
     * cleanup: bracketed cues (`[music]`), diarisation labels (`Speaker 1:`),
     * tokens under three characters and a broad English + French stop-word and
     * filler list are all removed; only the literal word forms survive. Returns
     * the top `$topN` words as `[{name, value}]` (value = corpus frequency),
     * dropping words that occur only once; null when there is nothing left.
     *
     * @param list<string> $texts
     * @return list<array{name:string,value:int}>|null
     */
    public static function buildTranscriptWordCloud(array $texts, int $topN = 150): ?array
    {
        if (!$texts) {
            return null;
        }
        $stop = self::transcriptStopWords();
        $counts = [];
        foreach ($texts as $text) {
            if (!is_string($text) || $text === '') {
                continue;
            }
            $t = mb_strtolower($text, 'UTF-8');
            // Drop bracketed audio cues and the "Speaker 1 / Speaker 2:" diarisation
            // labels (with or without the trailing colon). The bare word "speaker"
            // is stop-worded and digits never tokenise, but this also keeps the
            // label from being counted as a unit.
            $t = (string) preg_replace('/\[[^\]]*\]/u', ' ', $t);
            $t = (string) preg_replace('/\bspeakers?\s*\d+\s*:?/u', ' ', $t);
            // Tokenise on any non-letter (Unicode-aware, so accented French letters
            // survive). Apostrophes split too, shedding French elisions (l', d', qu').
            $tokens = preg_split('/[^\p{L}]+/u', $t, -1, PREG_SPLIT_NO_EMPTY);
            if (!$tokens) {
                continue;
            }
            foreach ($tokens as $tok) {
                if (mb_strlen($tok, 'UTF-8') < 3 || isset($stop[$tok])) {
                    continue;
                }
                $counts[$tok] = ($counts[$tok] ?? 0) + 1;
            }
        }
        if (!$counts) {
            return null;
        }
        arsort($counts);
        $out = [];
        foreach ($counts as $word => $n) {
            if ($n < 2) {
                break; // arsort is descending, so nothing past here clears the floor
            }
            $out[] = ['name' => (string) $word, 'value' => $n];
            if (count($out) >= $topN) {
                break;
            }
        }
        return $out ?: null;
    }

    /**
     * Stop-word / filler set for the transcript word cloud, keyed for O(1)
     * lookup. Aggressive by design (English + French function words, spoken
     * fillers, and podcast meta terms like "welcome"/"speaker"); topical words
     * (africa, knowledge, …) are deliberately kept. Tune this list freely — it is
     * the single knob on what the cloud surfaces. All entries are lower-case to
     * match the tokeniser.
     *
     * @return array<string,bool>
     */
    private static function transcriptStopWords(): array
    {
        $en = 'able about above across after again against all almost also although always among '
            . 'another any anybody anyone anything anyway are aren around because become been before '
            . 'began begin being below best better between both but came can cannot could couldn course '
            . 'did didn does doesn doing don done down during each either else enough especially even '
            . 'ever every everybody everyone everything few for from further gave get gets getting give '
            . 'given gives going gone got gotten had hadn has hasn have haven having her here hers herself '
            . 'him himself his how however indeed inside instead into isn its itself just keep kept kind '
            . 'knew know knowing known knows last later least less let lets like likely little look looking '
            . 'lot made make makes making many may maybe mean means meant might more most much must myself '
            . 'near need needs neither never new next nobody nor not nothing now off often okay once one '
            . 'ones only onto other others ought our ours ourselves out over own particular perhaps please '
            . 'put quite rather really right said same say saying says see seem seemed seems seen several '
            . 'shall she should shouldn since some somebody somehow someone something sometimes somewhat '
            . 'soon still stuff such sure take taken takes talk talked talking tell tells than thank thanks '
            . 'that the their theirs them themselves then there therefore these they thing things think '
            . 'thinking this those though thought through thus today together too took toward towards under '
            . 'until upon use used uses using usually very want wanted wants was wasn way ways well went '
            . 'were weren what whatever when where whereas whether which while who whoever whole whom whose '
            . 'why will with within without won would wouldn yeah yes yet you your yours yourself yourselves '
            . 'gonna wanna gotta lemme dunno yep nope hmm mhm uh huh okay actually basically literally '
            . 'obviously definitely probably certainly simply really pretty bit two three '
            . 'and sort guess lots';

        $meta = 'podcast podcasts episode episodes speaker speakers music applause laughter intro outro '
            . 'welcome cluster everybody everyone hello today session lecture lectures talk conversation conversations';

        $fr = 'alors après aussi autant autre autres avait avant avec avoir beaucoup bien car ceci cela '
            . 'celle celles celui cependant certains ces cet cette ceux chaque chez comme comment dans '
            . 'depuis derrière des deux devait devant doit donc dont elle elles encore entre était étaient '
            . 'étais étant été êtes être eux fait faire fais fait faites font ici ils jamais juste leur '
            . 'leurs lors lui mais mes moi moins mon naturellement notre nous nôtre par parce parfois '
            . 'pendant peu peut peuvent plupart plus plusieurs pour pourquoi pourtant quand que quel quelle '
            . 'quelles quelque quelques quels qui quoi sans sauf selon ses seulement sien sienne soit son '
            . 'sont sous souvent sur surtout tandis tant tellement tels tes toi ton tous tout toute toutes '
            . 'très trop une vers voici voilà vos votre vous '
            . 'est les des aux pas ont même déjà cette ces ils elles nous vous';

        return array_fill_keys(
            array_filter(preg_split('/\s+/', $en . ' ' . $meta . ' ' . $fr) ?: []),
            true
        );
    }
}
