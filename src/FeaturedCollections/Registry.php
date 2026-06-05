<?php
declare(strict_types=1);

namespace ResourceVisualizations\FeaturedCollections;

/**
 * Featured-collections registry — the single source of truth for the curated
 * "collections" experience: the landing-page card grid (FeaturedCollections
 * block) AND each per-collection detail gallery (PhotoBrowse block, when an
 * editor picks a featured collection). The precompute reads it too, so counts,
 * covers, sub-collection splits and journal-issue grouping never drift between
 * the three.
 *
 * Mirrors the amira dashboard's src/lib/utils/collectionsRegistry.ts. To feature
 * another collection, add an entry here — nothing else needs to change.
 *
 * A few collections are special:
 *   - ILAM groups its 1,032 articles into journal issues (grouping = 'issue'):
 *     each card is one issue (Vol. N No. M), clicking opens a table of contents.
 *     Its DOI (`bibo:doi`, …amj.vNiM…) encodes the volume/issue; a map view is
 *     pointless (one host location) so it is disabled.
 *   - Museu Afro-Digital is one Omeka item set (6295) holding three distinct
 *     sub-collections; each registry entry pins an `identifierPrefix` so the
 *     gallery shows only that sub-collection's items (split by the
 *     `dcterms:identifier` prefix: APMESTRENO / TRABNEGRBA / ORIXAFGM).
 */
final class Registry
{
    /**
     * @return list<array{
     *   slug:string, pageSlug:string, itemSetId:int, identifierPrefix:?string,
     *   title:string, tagline:?string, description:string, partner:?string,
     *   thumbnail:?string, views:array{masonry:bool,map:bool,timeline:bool},
     *   grouping:string, dedupe:bool
     * }>
     */
    public static function all(): array
    {
        return array_map([self::class, 'normalize'], [
            [
                'slug' => 'the-pre-death-bequest-of-gerd-spittler',
                'itemSetId' => 6279,
                'title' => 'The Pre-Death Bequest of Gerd Spittler',
                'description' => 'Research material of Gerd Spittler collected in West Africa from 1967 onwards — field notes, excerpts and copies from African archives, thousands of photographs, and Hausa and Tamacheck audio recordings — dedicated to completed research across the whole Cluster.',
            ],
            [
                'slug' => 'international-library-of-african-music-ilam',
                'itemSetId' => 27724,
                'title' => 'International Library of African Music (ILAM)',
                'description' => 'An external collection sourced from the International Library of African Music (ILAM), Africa’s foremost repository of music — ethnomusicological recordings, journals and photographic materials from across the continent.',
                'partner' => 'Published in collaboration with Rhodes University',
                // One host location → a map would be a single marker.
                'views' => ['map' => false],
                // Articles share a journal-issue cover; group them into issues
                // (Vol. N No. M) with a table of contents, keyed off the DOI.
                'grouping' => 'issue',
                'dedupe' => true,
            ],
            [
                'slug' => 'memorias-perifericas-capoeira-angola-salvador',
                'itemSetId' => 6295,
                'identifierPrefix' => 'APMESTRENO',
                'title' => 'Memória Periféricas da Capoeira Angola de Salvador',
                'description' => 'Peripheral Memories of Capoeira Angola in Salvador — the personal archive of Mestre Nô.',
                'partner' => 'Part of the Museu Afro-Digital — Universidade Federal da Bahia',
            ],
            [
                'slug' => 'trabalhadores-na-da-bahia',
                'itemSetId' => 6295,
                'identifierPrefix' => 'TRABNEGRBA',
                'title' => 'Trabalhadores na/da Bahia',
                'description' => 'Workers in/from Bahia — Black labour in the city and the Recôncavo.',
                'partner' => 'Part of the Museu Afro-Digital — Universidade Federal da Bahia',
            ],
            [
                'slug' => 'orixas-fundacao-gregorio-de-mattos',
                'itemSetId' => 6295,
                'identifierPrefix' => 'ORIXAFGM',
                'title' => 'Orixás - Fundação Gregório de Mattos',
                'description' => 'Orishas — from the Gregório de Mattos Foundation.',
                'partner' => 'Part of the Museu Afro-Digital — Universidade Federal da Bahia',
            ],
        ]);
    }

    /** A registry entry by slug, or null. */
    public static function bySlug(string $slug): ?array
    {
        foreach (self::all() as $entry) {
            if ($entry['slug'] === $slug) {
                return $entry;
            }
        }
        return null;
    }

    /** All entries that draw from a given item set (Museu's three share 6295). */
    public static function forItemSet(int $itemSetId): array
    {
        return array_values(array_filter(
            self::all(),
            static fn (array $e): bool => $e['itemSetId'] === $itemSetId
        ));
    }

    /** Distinct item-set ids referenced by the registry — used by the precompute. */
    public static function itemSetIds(): array
    {
        $ids = [];
        foreach (self::all() as $entry) {
            $ids[$entry['itemSetId']] = true;
        }
        return array_keys($ids);
    }

    /** `slug => title`, for a block's editor dropdown. */
    public static function selectOptions(): array
    {
        $opts = [];
        foreach (self::all() as $entry) {
            $opts[$entry['slug']] = $entry['title'];
        }
        return $opts;
    }

    /** Fill defaults so callers can read every key without isset() noise. */
    private static function normalize(array $e): array
    {
        return [
            'slug' => (string) $e['slug'],
            // Cards link to the Omeka page that hosts this collection's gallery;
            // defaults to the slug (create the page with a matching slug).
            'pageSlug' => (string) ($e['pageSlug'] ?? $e['slug']),
            'itemSetId' => (int) $e['itemSetId'],
            'identifierPrefix' => isset($e['identifierPrefix']) ? (string) $e['identifierPrefix'] : null,
            'title' => (string) $e['title'],
            'tagline' => isset($e['tagline']) ? (string) $e['tagline'] : null,
            'description' => (string) ($e['description'] ?? ''),
            'partner' => isset($e['partner']) ? (string) $e['partner'] : null,
            'thumbnail' => isset($e['thumbnail']) ? (string) $e['thumbnail'] : null,
            'views' => [
                'masonry' => (bool) ($e['views']['masonry'] ?? true),
                'map' => (bool) ($e['views']['map'] ?? true),
                'timeline' => (bool) ($e['views']['timeline'] ?? true),
            ],
            'grouping' => ($e['grouping'] ?? 'photo') === 'issue' ? 'issue' : 'photo',
            'dedupe' => (bool) ($e['dedupe'] ?? false),
        ];
    }
}
