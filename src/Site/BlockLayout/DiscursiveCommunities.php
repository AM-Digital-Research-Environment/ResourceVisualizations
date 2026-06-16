<?php
namespace DreVisualizations\Site\BlockLayout;

use Laminas\View\Renderer\PhpRenderer;
use Omeka\Api\Representation\SitePageBlockRepresentation;
use Omeka\Api\Representation\SitePageRepresentation;
use Omeka\Api\Representation\SiteRepresentation;
use Omeka\Site\BlockLayout\AbstractBlockLayout;

class DiscursiveCommunities extends AbstractBlockLayout
{
    public function getLabel()
    {
        return 'Discursive Communities'; // @translate
    }

    public function form(PhpRenderer $view, SiteRepresentation $site,
        ?SitePageRepresentation $page = null, ?SitePageBlockRepresentation $block = null)
    {
        return '<p>' . $view->translate('Collection-wide entity network: people, organisations, places, subjects and tags that co-occur across the research items, rendered as an explorable force-directed graph (MapLibre GL, positions precomputed) and coloured by entity type. No configuration needed.') . '</p>';
    }

    public function render(PhpRenderer $view, SitePageBlockRepresentation $block,
        $templateViewScript = 'common/block-layout/discursive-communities')
    {
        return $view->partial($templateViewScript, [
            'block' => $block,
        ]);
    }
}
