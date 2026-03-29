<?php
namespace ResourceVisualizations;

return [
    'resource_page_block_layouts' => [
        'invokables' => [
            'knowledgeGraph' => Site\ResourcePageBlockLayout\KnowledgeGraph::class,
            'itemSetDashboard' => Site\ResourcePageBlockLayout\ItemSetDashboard::class,
            'linkedItemsDashboard' => Site\ResourcePageBlockLayout\LinkedItemsDashboard::class,
            'compareProjects' => Site\ResourcePageBlockLayout\CompareProjects::class,
        ],
    ],
    'view_manager' => [
        'template_path_stack' => [
            dirname(__DIR__) . '/view',
        ],
    ],
];
