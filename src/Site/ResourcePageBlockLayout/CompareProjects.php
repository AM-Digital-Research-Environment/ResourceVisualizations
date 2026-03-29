<?php
namespace ResourceVisualizations\Site\ResourcePageBlockLayout;

use Laminas\View\Renderer\PhpRenderer;
use Omeka\Api\Representation\AbstractResourceEntityRepresentation;
use Omeka\Site\ResourcePageBlockLayout\ResourcePageBlockLayoutInterface;

class CompareProjects implements ResourcePageBlockLayoutInterface
{
    public function getLabel(): string
    {
        return 'Compare Projects'; // @translate
    }

    public function getCompatibleResourceNames(): array
    {
        return ['items'];
    }

    public function render(PhpRenderer $view, AbstractResourceEntityRepresentation $resource): string
    {
        return $view->partial('common/resource-page-block-layout/compare-projects', [
            'resource' => $resource,
        ]);
    }
}
