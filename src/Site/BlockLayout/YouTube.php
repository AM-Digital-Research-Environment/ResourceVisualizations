<?php
namespace ResourceVisualizations\Site\BlockLayout;

use Laminas\View\Renderer\PhpRenderer;
use Omeka\Api\Representation\SitePageBlockRepresentation;
use Omeka\Api\Representation\SitePageRepresentation;
use Omeka\Api\Representation\SiteRepresentation;
use Omeka\Site\BlockLayout\AbstractBlockLayout;

class YouTube extends AbstractBlockLayout
{
    public function getLabel()
    {
        return 'YouTube'; // @translate
    }

    public function form(PhpRenderer $view, SiteRepresentation $site,
        ?SitePageRepresentation $page = null, ?SitePageBlockRepresentation $block = null)
    {
        return '<p>' . $view->translate('Analytics for the cluster YouTube channel: videos by year, the language mix and how it shifts over time, the channel\'s playlists, and any credited speakers. No configuration needed.') . '</p>';
    }

    public function render(PhpRenderer $view, SitePageBlockRepresentation $block,
        $templateViewScript = 'common/block-layout/youtube')
    {
        return $view->partial($templateViewScript, [
            'block' => $block,
        ]);
    }
}
