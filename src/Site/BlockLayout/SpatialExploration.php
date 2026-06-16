<?php
namespace DreVisualizations\Site\BlockLayout;

use Laminas\View\Renderer\PhpRenderer;
use Omeka\Api\Representation\SitePageBlockRepresentation;
use Omeka\Api\Representation\SitePageRepresentation;
use Omeka\Api\Representation\SiteRepresentation;
use Omeka\Site\BlockLayout\AbstractBlockLayout;

class SpatialExploration extends AbstractBlockLayout
{
    public function getLabel()
    {
        return 'Spatial Exploration'; // @translate
    }

    public function form(PhpRenderer $view, SiteRepresentation $site,
        ?SitePageRepresentation $page = null, ?SitePageBlockRepresentation $block = null)
    {
        return '<p>' . $view->translate('Collection-wide map of every geocoded place the research items reference (origins and current locations), as bubbles sized by how many items mention each place. A sidebar lets visitors filter the map to a single project, research section, person, organisation or subject, and a country dropdown zooms in. Positions are precomputed (MapLibre GL). No configuration needed.') . '</p>';
    }

    public function render(PhpRenderer $view, SitePageBlockRepresentation $block,
        $templateViewScript = 'common/block-layout/spatial-exploration')
    {
        return $view->partial($templateViewScript, [
            'block' => $block,
        ]);
    }
}
