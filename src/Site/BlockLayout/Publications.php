<?php
namespace ResourceVisualizations\Site\BlockLayout;

use Laminas\View\Renderer\PhpRenderer;
use Omeka\Api\Representation\SitePageBlockRepresentation;
use Omeka\Api\Representation\SitePageRepresentation;
use Omeka\Api\Representation\SiteRepresentation;
use Omeka\Site\BlockLayout\AbstractBlockLayout;

class Publications extends AbstractBlockLayout
{
    public function getLabel()
    {
        return 'Publications'; // @translate
    }

    public function form(PhpRenderer $view, SiteRepresentation $site,
        ?SitePageRepresentation $page = null, ?SitePageBlockRepresentation $block = null)
    {
        return '<p>' . $view->translate('Bibliographic analytics across all publications (articles, books, chapters, …): by-template breakdown, top venues and authors, co-author network and keyword co-occurrence. No configuration needed.') . '</p>';
    }

    public function render(PhpRenderer $view, SitePageBlockRepresentation $block,
        $templateViewScript = 'common/block-layout/publications')
    {
        return $view->partial($templateViewScript, [
            'block' => $block,
        ]);
    }
}
