<?php
namespace DreVisualizations\Site\BlockLayout;

use Laminas\Form\Element;
use Laminas\View\Renderer\PhpRenderer;
use Omeka\Api\Representation\SitePageBlockRepresentation;
use Omeka\Api\Representation\SitePageRepresentation;
use Omeka\Api\Representation\SiteRepresentation;
use Omeka\Site\BlockLayout\AbstractBlockLayout;
use DreVisualizations\FeaturedCollections\Registry;

/**
 * Photo Browsing site-page block.
 *
 * The editor picks one (image-heavy) item set; the view server-renders that
 * set's image-bearing items into masonry / map / timeline browsers with a
 * lightbox. Thumbnails come straight from Omeka S derivatives, coordinates from
 * geo:lat/geo:long, dates from the usual date properties.
 *
 * Optionally the editor instead picks a **Featured collection** (see
 * {@see Registry}); the block then pulls the item set, an optional
 * sub-collection filter (e.g. one of Museu Afro-Digital's three sub-collections,
 * split by dcterms:identifier prefix), the grouping mode (journal issues for
 * ILAM) and the allowed views from the registry — so the three Museu pages can
 * all draw from item set 6295 yet show different sub-collections, and ILAM
 * renders as issues with a table of contents.
 *
 * Editorial control by design (Phase 6): drop one block per gallery on any
 * curated site page. The rendering engine (asset/js/item-set-photo-views.js) is
 * surface-agnostic.
 */
class PhotoBrowse extends AbstractBlockLayout
{
    /** Available view modes, in toggle order. */
    const VIEWS = ['masonry', 'map', 'timeline'];

    public function getLabel()
    {
        return 'Photo Browsing'; // @translate
    }

    public function form(PhpRenderer $view, SiteRepresentation $site,
        ?SitePageRepresentation $page = null, ?SitePageBlockRepresentation $block = null)
    {
        $data = $block ? $block->data() : [];

        // A curated featured collection (optional). When set, it supplies the
        // item set, sub-collection filter, grouping and views — so the editor
        // need not pick an item set, and the three Museu sub-collections (same
        // item set 6295) are told apart by the chosen entry.
        $featured = new Element\Select('o:block[__blockIndex__][o:data][featured_collection]');
        $featured->setValueOptions(Registry::selectOptions())
            ->setEmptyOption($view->translate('— None (plain item-set gallery) —'))
            ->setValue($data['featured_collection'] ?? '');

        // Item-set options: prefer the sets assigned to this site; fall back to
        // every item set when the site has none assigned (research collections
        // often are not site-scoped). Sorted by title for a usable dropdown.
        $valueOptions = $this->itemSetOptions($view, $site);

        $itemSet = new Element\Select('o:block[__blockIndex__][o:data][item_set]');
        $itemSet->setValueOptions($valueOptions)
            ->setEmptyOption($view->translate('Select an item set…'))
            ->setAttribute('class', 'chosen-select')
            ->setValue($data['item_set'] ?? '');

        $heading = new Element\Text('o:block[__blockIndex__][o:data][heading]');
        $heading->setAttribute('placeholder', $view->translate('Optional gallery title'))
            ->setValue($data['heading'] ?? '');

        $defaultView = new Element\Select('o:block[__blockIndex__][o:data][default_view]');
        $defaultView->setValueOptions([
            'masonry'  => $view->translate('Grid (masonry)'),
            'map'      => $view->translate('Map'),
            'timeline' => $view->translate('Timeline'),
        ])->setValue($data['default_view'] ?? 'masonry');

        return $this->field($view,
                $view->translate('Featured collection'),
                $view->translate('Optional. Pick a curated collection to apply its item set, sub-collection filter, journal-issue grouping and views automatically. Leave as “None” to configure a plain gallery below.'),
                $view->formSelect($featured))
            . $this->field($view,
                $view->translate('Item set'),
                $view->translate('The image-heavy item set to display as a photo gallery. Ignored when a Featured collection is selected above.'),
                $view->formSelect($itemSet))
            . $this->field($view,
                $view->translate('Gallery title'),
                $view->translate('Optional heading shown above the gallery.'),
                $view->formText($heading))
            . $this->field($view,
                $view->translate('Default view'),
                $view->translate('Which browser opens first. Map and Timeline are hidden automatically when they do not apply (no coordinates / dates, or a journal-issue collection).'),
                $view->formSelect($defaultView));
    }

    public function render(PhpRenderer $view, SitePageBlockRepresentation $block,
        $templateViewScript = 'common/block-layout/photo-browse')
    {
        // A featured collection wins over an explicit item set.
        $entry = null;
        $slug = (string) $block->dataValue('featured_collection', '');
        if ($slug !== '') {
            $entry = Registry::bySlug($slug);
        }

        // Auto-apply: when no collection was picked but the chosen item set maps
        // to exactly one whole-set registry entry (ILAM, Gerd Spittler — not the
        // prefix-split Museu sub-collections, which are ambiguous and must be
        // chosen), use it. So those existing gallery pages gain issue grouping /
        // partner credit without re-wiring.
        $rawSet = $block->dataValue('item_set');
        if ($entry === null && $rawSet) {
            $candidates = Registry::forItemSet((int) $rawSet);
            if (count($candidates) === 1 && $candidates[0]['identifierPrefix'] === null) {
                $entry = $candidates[0];
            }
        }

        $itemSetId = $entry ? $entry['itemSetId'] : $rawSet;
        $itemSetId = $itemSetId ? (int) $itemSetId : null;

        $grouping = $entry ? $entry['grouping'] : 'photo';
        $prefix = $entry ? ($entry['identifierPrefix'] ?? null) : null;
        $partner = $entry ? ($entry['partner'] ?? null) : null;
        // Heading: only the editor's explicit heading. Featured-collection pages
        // already carry a Page Title block with the collection name, so the
        // gallery does not repeat it (it shows the partner credit + counts).
        $heading = (string) $block->dataValue('heading', '');

        // Allowed views: the registry can opt a collection out of map/timeline;
        // issue grouping is masonry-only (each card is a journal issue).
        $allowedViews = $entry ? $entry['views'] : ['masonry' => true, 'map' => true, 'timeline' => true];
        if ($grouping === 'issue') {
            $allowedViews = ['masonry' => true, 'map' => false, 'timeline' => false];
        }

        $defaultView = $block->dataValue('default_view', 'masonry');
        if (!in_array($defaultView, self::VIEWS, true)) {
            $defaultView = 'masonry';
        }

        return $view->partial($templateViewScript, [
            'block'           => $block,
            'itemSetId'       => $itemSetId,
            'heading'         => $heading,
            'defaultView'     => $defaultView,
            'precomputed'     => $itemSetId ? $this->loadGallery($itemSetId) : null,
            'identifierPrefix' => $prefix,
            'grouping'        => $grouping,
            'partner'         => $partner,
            'allowedViews'    => $allowedViews,
        ]);
    }

    /**
     * Load the precomputed gallery for an item set, or null when absent — in
     * which case the view falls back to resolving the gallery live (so a newly
     * added block still works before the next "Regenerate"). Written by the
     * precompute job to asset/data/photo-galleries/{itemSetId}.json.
     *
     * @return array{total:int,photos:array<int,array<string,mixed>>}|null
     */
    private function loadGallery(int $itemSetId): ?array
    {
        // src/Site/BlockLayout/PhotoBrowse.php → module root is three levels up.
        $file = dirname(__DIR__, 3) . '/asset/data/photo-galleries/' . $itemSetId . '.json';
        if (!is_readable($file)) {
            return null;
        }
        $data = json_decode((string) file_get_contents($file), true);
        return (is_array($data) && isset($data['photos']) && is_array($data['photos'])) ? $data : null;
    }

    /** Build the `field` markup Omeka's page editor expects. */
    private function field(PhpRenderer $view, string $label, string $description, string $input): string
    {
        return '<div class="field">'
            . '<div class="field-meta">'
            . '<label>' . $view->escapeHtml($label) . '</label>'
            . '<div class="field-description">' . $view->escapeHtml($description) . '</div>'
            . '</div>'
            . '<div class="inputs">' . $input . '</div>'
            . '</div>';
    }

    /** @return array<int|string,string> item-set id => title */
    private function itemSetOptions(PhpRenderer $view, SiteRepresentation $site): array
    {
        $build = function (array $itemSets): array {
            $opts = [];
            foreach ($itemSets as $itemSet) {
                $opts[$itemSet->id()] = $itemSet->displayTitle();
            }
            natcasesort($opts);
            return $opts;
        };

        $siteSets = $view->api()->search('item_sets', ['site_id' => $site->id()])->getContent();
        $opts = $build($siteSets);
        if ($opts) {
            return $opts;
        }
        // No site-assigned sets — offer all of them.
        return $build($view->api()->search('item_sets')->getContent());
    }
}
