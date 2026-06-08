<?php
namespace DreVisualizations\Site\BlockLayout;

use Laminas\View\Renderer\PhpRenderer;
use Omeka\Api\Representation\SitePageBlockRepresentation;
use Omeka\Api\Representation\SitePageRepresentation;
use Omeka\Api\Representation\SiteRepresentation;
use Omeka\Site\BlockLayout\AbstractBlockLayout;

class CompareEntity extends AbstractBlockLayout
{
    public function getLabel()
    {
        return 'Compare (any entity)'; // @translate
    }

    public function form(PhpRenderer $view, SiteRepresentation $site,
        ?SitePageRepresentation $page = null, ?SitePageBlockRepresentation $block = null)
    {
        return '<p>' . $view->translate('Side-by-side comparison of any two entities of the same type (projects, people, institutions, subjects, languages), with an in-page type switcher. No configuration needed.') . '</p>';
    }

    public function render(PhpRenderer $view, SitePageBlockRepresentation $block,
        $templateViewScript = 'common/block-layout/compare-entity')
    {
        return $view->partial($templateViewScript, [
            'block' => $block,
        ]);
    }
}
