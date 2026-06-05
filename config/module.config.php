<?php
namespace ResourceVisualizations;

return [
    'block_layouts' => [
        'invokables' => [
            'collectionOverview' => Site\BlockLayout\CollectionOverview::class,
            'collectionDashboard' => Site\BlockLayout\CollectionDashboard::class,
            'discursiveCommunities' => Site\BlockLayout\DiscursiveCommunities::class,
            'publications' => Site\BlockLayout\Publications::class,
            'projectExplorer' => Site\BlockLayout\ProjectExplorer::class,
            'compareEntity' => Site\BlockLayout\CompareEntity::class,
            'whatsNew' => Site\BlockLayout\WhatsNew::class,
            'photoBrowse' => Site\BlockLayout\PhotoBrowse::class,
            'featuredCollections' => Site\BlockLayout\FeaturedCollections::class,
        ],
    ],
    'resource_page_block_layouts' => [
        'invokables' => [
            'knowledgeGraph' => Site\ResourcePageBlockLayout\KnowledgeGraph::class,
            'itemSetDashboard' => Site\ResourcePageBlockLayout\ItemSetDashboard::class,
            'linkedItemsDashboard' => Site\ResourcePageBlockLayout\LinkedItemsDashboard::class,
            'siblingItemsSparkline' => Site\ResourcePageBlockLayout\SiblingItemsSparkline::class,
        ],
    ],
    'view_manager' => [
        'template_path_stack' => [
            dirname(__DIR__) . '/view',
        ],
    ],
    'view_helpers' => [
        'invokables' => [
            'dashboardAssets' => View\Helper\DashboardAssets::class,
        ],
    ],
    'controllers' => [
        'invokables' => [
            Controller\Admin\MaintenanceController::class => Controller\Admin\MaintenanceController::class,
        ],
    ],
    'form_elements' => [
        'invokables' => [
            Form\MaintenanceForm::class => Form\MaintenanceForm::class,
        ],
    ],
    'router' => [
        'routes' => [
            'admin' => [
                'child_routes' => [
                    'resource-visualizations' => [
                        'type' => \Laminas\Router\Http\Literal::class,
                        'options' => [
                            'route' => '/resource-visualizations',
                            'defaults' => [
                                '__NAMESPACE__' => 'ResourceVisualizations\Controller\Admin',
                                'controller' => Controller\Admin\MaintenanceController::class,
                                'action' => 'index',
                            ],
                        ],
                        'may_terminate' => true,
                        'child_routes' => [
                            'maintenance' => [
                                'type' => \Laminas\Router\Http\Literal::class,
                                'options' => [
                                    'route' => '/maintenance',
                                    'defaults' => [
                                        'controller' => Controller\Admin\MaintenanceController::class,
                                        'action' => 'index',
                                    ],
                                ],
                            ],
                            'maintenance-regenerate' => [
                                'type' => \Laminas\Router\Http\Literal::class,
                                'options' => [
                                    'route' => '/maintenance/regenerate',
                                    'defaults' => [
                                        'controller' => Controller\Admin\MaintenanceController::class,
                                        'action' => 'regenerate',
                                    ],
                                ],
                            ],
                        ],
                    ],
                ],
            ],
        ],
    ],
    'navigation' => [
        'AdminModule' => [
            [
                'label' => 'Resource Visualizations', // @translate
                'route' => 'admin/resource-visualizations/maintenance',
                'resource' => Controller\Admin\MaintenanceController::class,
                'class' => 'o-icon-chart',
                'pages' => [
                    [
                        'route' => 'admin/resource-visualizations/maintenance-regenerate',
                        'visible' => false,
                    ],
                ],
            ],
        ],
    ],
];
