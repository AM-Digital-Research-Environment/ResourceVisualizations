<?php
namespace DreVisualizations\Site\BlockLayout;

use Laminas\View\Renderer\PhpRenderer;
use Omeka\Api\Representation\SitePageBlockRepresentation;
use Omeka\Api\Representation\SitePageRepresentation;
use Omeka\Api\Representation\SiteRepresentation;
use Omeka\Site\BlockLayout\AbstractBlockLayout;

/**
 * The full collection dashboard — every aggregate visualization across the
 * entire collection (timelines, gantt, heatmaps, sunburst, chord, networks,
 * maps, …). This is the exhaustive view; for the curated home-page version see
 * the "Collection Overview" block. Both read the same precomputed
 * collection-overview.json; this one renders it with the complete `section`
 * layout while Collection Overview uses the trimmed `collectionOverview` layout.
 */
class CollectionDashboard extends AbstractBlockLayout
{
    public function getLabel()
    {
        return 'Collection Dashboard'; // @translate
    }

    public function form(PhpRenderer $view, SiteRepresentation $site,
        ?SitePageRepresentation $page = null, ?SitePageBlockRepresentation $block = null)
    {
        return '<p>' . $view->translate('The full set of aggregate visualisations across the entire collection. For a curated, home-page-friendly subset use the "Collection Overview" block instead. No configuration needed.') . '</p>';
    }

    public function render(PhpRenderer $view, SitePageBlockRepresentation $block,
        $templateViewScript = 'common/block-layout/collection-dashboard')
    {
        return $view->partial($templateViewScript, [
            'block' => $block,
        ]);
    }
}
