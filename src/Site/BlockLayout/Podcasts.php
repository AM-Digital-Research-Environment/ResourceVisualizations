<?php
namespace DreVisualizations\Site\BlockLayout;

use Laminas\View\Renderer\PhpRenderer;
use Omeka\Api\Representation\SitePageBlockRepresentation;
use Omeka\Api\Representation\SitePageRepresentation;
use Omeka\Api\Representation\SiteRepresentation;
use Omeka\Site\BlockLayout\AbstractBlockLayout;

class Podcasts extends AbstractBlockLayout
{
    public function getLabel()
    {
        return 'Podcasts'; // @translate
    }

    public function form(PhpRenderer $view, SiteRepresentation $site,
        ?SitePageRepresentation $page = null, ?SitePageBlockRepresentation $block = null)
    {
        return '<p>' . $view->translate('Analytics for the cluster podcast episodes: a word cloud built from the episode transcripts, the most frequent speakers, episode length, the publication timeline, and the series breakdown. No configuration needed.') . '</p>';
    }

    public function render(PhpRenderer $view, SitePageBlockRepresentation $block,
        $templateViewScript = 'common/block-layout/podcasts')
    {
        return $view->partial($templateViewScript, [
            'block' => $block,
        ]);
    }
}
