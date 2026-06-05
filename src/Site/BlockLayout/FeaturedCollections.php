<?php
namespace ResourceVisualizations\Site\BlockLayout;

use Laminas\Form\Element;
use Laminas\View\Renderer\PhpRenderer;
use Omeka\Api\Representation\SitePageBlockRepresentation;
use Omeka\Api\Representation\SitePageRepresentation;
use Omeka\Api\Representation\SiteRepresentation;
use Omeka\Site\BlockLayout\AbstractBlockLayout;
use ResourceVisualizations\FeaturedCollections\Registry;

/**
 * Featured Collections landing block.
 *
 * Renders the curated {@see Registry} as a grid of collection cards (cover
 * mosaic, title, tagline, description, partner credit, item/photo counts and a
 * "Browse →" call to action), each linking to that collection's detail page.
 * Mirrors the amira dashboard's /collections index.
 *
 * Per-collection counts and cover images come from the precompute
 * (asset/data/featured-collections/index.json, built by the admin "Regenerate"
 * job); when that file is absent the block resolves them live through the Omeka
 * API so a freshly added block still works. The curated list itself never needs
 * editor configuration — add a collection to the Registry and it appears here.
 */
class FeaturedCollections extends AbstractBlockLayout
{
    /** Cover images shown in a card's mosaic. */
    const COVER_LIMIT = 4;

    /** Live-fallback safety bound when scanning an item set for covers/counts. */
    const SCAN_CAP = 600;

    public function getLabel()
    {
        return 'Featured Collections'; // @translate
    }

    public function form(PhpRenderer $view, SiteRepresentation $site,
        ?SitePageRepresentation $page = null, ?SitePageBlockRepresentation $block = null)
    {
        $data = $block ? $block->data() : [];

        $heading = new Element\Text('o:block[__blockIndex__][o:data][heading]');
        $heading->setAttribute('placeholder', $view->translate('Optional section heading'))
            ->setValue($data['heading'] ?? '');

        return '<div class="field">'
            . '<div class="field-meta"><label>' . $view->escapeHtml($view->translate('Heading')) . '</label>'
            . '<div class="field-description">'
            . $view->escapeHtml($view->translate('Optional heading shown above the collection grid. The collections themselves come from the module registry.'))
            . '</div></div>'
            . '<div class="inputs">' . $view->formText($heading) . '</div>'
            . '</div>';
    }

    public function render(PhpRenderer $view, SitePageBlockRepresentation $block,
        $templateViewScript = 'common/block-layout/featured-collections')
    {
        return $view->partial($templateViewScript, [
            'block'    => $block,
            'heading'  => (string) $block->dataValue('heading', ''),
            'entries'  => Registry::all(),
            'cardData' => $this->cardData($view),
        ]);
    }

    /**
     * Per-slug card data: `['itemCount'=>int, 'photoCount'=>?int, 'covers'=>string[]]`.
     * Prefers the precomputed index; falls back to a live API scan.
     *
     * @return array<string,array{itemCount:int,photoCount:?int,covers:array<int,string>}>
     */
    private function cardData(PhpRenderer $view): array
    {
        $index = $this->loadIndex();
        $out = [];

        // Live fallback fetches each prefix-split set once, then filters per entry.
        $fetched = [];

        foreach (Registry::all() as $entry) {
            $slug = $entry['slug'];

            // Fast path: the precomputed index. Covers are stored as storage ids.
            if (isset($index[$slug]) && is_array($index[$slug])) {
                $row = $index[$slug];
                $covers = [];
                foreach (($row['covers'] ?? []) as $storage) {
                    $storage = (string) $storage;
                    if ($storage !== '') {
                        $covers[] = $view->basePath() . '/files/large/' . $storage . '.jpg';
                    }
                }
                $out[$slug] = [
                    'itemCount'  => (int) ($row['itemCount'] ?? 0),
                    'photoCount' => isset($row['photoCount']) ? (int) $row['photoCount'] : null,
                    'covers'     => $covers,
                ];
                continue;
            }

            // Live fallback.
            $setId = $entry['itemSetId'];
            $prefix = $entry['identifierPrefix'] ?? null;
            if ($prefix !== null) {
                if (!isset($fetched[$setId])) {
                    $fetched[$setId] = $this->scanSet($view, $setId);
                }
                $covers = [];
                $itemCount = 0;
                foreach ($fetched[$setId] as $rec) {
                    if (!str_starts_with($rec['ident'], $prefix)) {
                        continue;
                    }
                    $itemCount++;
                    if ($rec['thumb'] !== null && count($covers) < self::COVER_LIMIT) {
                        $covers[] = $rec['thumb'];
                    }
                }
                $out[$slug] = ['itemCount' => $itemCount, 'photoCount' => null, 'covers' => $covers];
            } else {
                $out[$slug] = $this->scanSetSummary($view, $setId);
            }
        }

        return $out;
    }

    /**
     * Live scan of a (small, prefix-split) item set: every item's first
     * identifier + a large-thumbnail URL when it bears an image.
     *
     * @return array<int,array{ident:string,thumb:?string}>
     */
    private function scanSet(PhpRenderer $view, int $setId): array
    {
        $records = [];
        $page = 1;
        do {
            $items = $view->api()->search('items', [
                'item_set_id' => $setId,
                'per_page'    => 100,
                'page'        => $page,
            ])->getContent();
            foreach ($items as $item) {
                if (count($records) >= self::SCAN_CAP) {
                    break 2;
                }
                $idv = $item->value('dcterms:identifier');
                $media = $item->primaryMedia();
                $records[] = [
                    'ident' => $idv ? trim((string) $idv) : '',
                    'thumb' => ($media && $media->hasThumbnails()) ? $media->thumbnailUrl('large') : null,
                ];
            }
            $page++;
        } while (count($items) === 100);
        return $records;
    }

    /**
     * Cheap summary for a whole item set: total count via the API + a few cover
     * thumbnails from the first page.
     *
     * @return array{itemCount:int,photoCount:?int,covers:array<int,string>}
     */
    private function scanSetSummary(PhpRenderer $view, int $setId): array
    {
        $response = $view->api()->search('items', ['item_set_id' => $setId, 'limit' => 0]);
        $itemCount = (int) $response->getTotalResults();

        $covers = [];
        $sample = $view->api()->search('items', ['item_set_id' => $setId, 'per_page' => 16])->getContent();
        foreach ($sample as $item) {
            if (count($covers) >= self::COVER_LIMIT) {
                break;
            }
            $media = $item->primaryMedia();
            if ($media && $media->hasThumbnails()) {
                $covers[] = $media->thumbnailUrl('large');
            }
        }
        return ['itemCount' => $itemCount, 'photoCount' => null, 'covers' => $covers];
    }

    /** @return array<string,array<string,mixed>>|array<string,mixed> */
    private function loadIndex(): array
    {
        // src/Site/BlockLayout/FeaturedCollections.php → module root is three up.
        $file = dirname(__DIR__, 3) . '/asset/data/featured-collections/index.json';
        if (!is_readable($file)) {
            return [];
        }
        $data = json_decode((string) file_get_contents($file), true);
        return is_array($data) ? $data : [];
    }
}
