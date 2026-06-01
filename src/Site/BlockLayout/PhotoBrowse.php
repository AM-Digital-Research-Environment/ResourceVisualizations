<?php
namespace ResourceVisualizations\Site\BlockLayout;

use Laminas\Form\Element;
use Laminas\View\Renderer\PhpRenderer;
use Omeka\Api\Representation\SitePageBlockRepresentation;
use Omeka\Api\Representation\SitePageRepresentation;
use Omeka\Api\Representation\SiteRepresentation;
use Omeka\Site\BlockLayout\AbstractBlockLayout;

/**
 * Photo Browsing site-page block.
 *
 * The editor picks one (image-heavy) item set; the view server-renders that
 * set's image-bearing items into masonry / map / timeline browsers with a
 * lightbox. Thumbnails come straight from Omeka S derivatives, coordinates from
 * geo:lat/geo:long, dates from the usual date properties — so there is NO new
 * precompute: everything is resolved at page-render time by the partial.
 *
 * Editorial control by design (Phase 6): drop one block per gallery on any
 * curated site page, rather than auto-attaching to every item-set page. The
 * rendering engine (asset/js/item-set-photo-views.js) is surface-agnostic, so
 * the same views could later be mounted on the item-set resource page too.
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

        // Item-set options: prefer the sets assigned to this site; fall back to
        // every item set when the site has none assigned (research collections
        // often are not site-scoped). Sorted by title for a usable dropdown.
        $valueOptions = $this->itemSetOptions($view, $site);

        $itemSet = new Element\Select('o:block[__blockIndex__][o:data][item_set]');
        $itemSet->setValueOptions($valueOptions)
            ->setEmptyOption($view->translate('Select an item set…'))
            ->setAttribute('class', 'chosen-select')
            ->setAttribute('required', true)
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
                $view->translate('Item set'),
                $view->translate('The image-heavy item set to display as a photo gallery.'),
                $view->formSelect($itemSet))
            . $this->field($view,
                $view->translate('Gallery title'),
                $view->translate('Optional heading shown above the gallery.'),
                $view->formText($heading))
            . $this->field($view,
                $view->translate('Default view'),
                $view->translate('Which browser opens first. Map and Timeline are hidden automatically when the set has no coordinates / dates.'),
                $view->formSelect($defaultView));
    }

    public function render(PhpRenderer $view, SitePageBlockRepresentation $block,
        $templateViewScript = 'common/block-layout/photo-browse')
    {
        $itemSetId = $block->dataValue('item_set');
        $itemSetId = $itemSetId ? (int) $itemSetId : null;
        $defaultView = $block->dataValue('default_view', 'masonry');
        if (!in_array($defaultView, self::VIEWS, true)) {
            $defaultView = 'masonry';
        }

        return $view->partial($templateViewScript, [
            'block'       => $block,
            'itemSetId'   => $itemSetId,
            'heading'     => (string) $block->dataValue('heading', ''),
            'defaultView' => $defaultView,
            'precomputed' => $itemSetId ? $this->loadGallery($itemSetId) : null,
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
