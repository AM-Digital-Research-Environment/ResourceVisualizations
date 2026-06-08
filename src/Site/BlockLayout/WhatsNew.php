<?php
namespace DreVisualizations\Site\BlockLayout;

use Laminas\View\Renderer\PhpRenderer;
use Omeka\Api\Representation\SitePageBlockRepresentation;
use Omeka\Api\Representation\SitePageRepresentation;
use Omeka\Api\Representation\SiteRepresentation;
use Omeka\Site\BlockLayout\AbstractBlockLayout;

class WhatsNew extends AbstractBlockLayout
{
    public function getLabel()
    {
        return "What's New"; // @translate
    }

    public function form(PhpRenderer $view, SiteRepresentation $site,
        ?SitePageRepresentation $page = null, ?SitePageBlockRepresentation $block = null)
    {
        return '<p>' . $view->translate('Recent additions and the most-active projects, in 3 / 6 / 12-month windows. No configuration needed.') . '</p>';
    }

    public function render(PhpRenderer $view, SitePageBlockRepresentation $block,
        $templateViewScript = 'common/block-layout/whats-new')
    {
        return $view->partial($templateViewScript, [
            'block' => $block,
        ]);
    }
}
