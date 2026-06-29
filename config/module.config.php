<?php
namespace DreVisualizations;

return [
    'block_layouts' => [
        'invokables' => [
            'collectionOverview' => Site\BlockLayout\CollectionOverview::class,
            'collectionDashboard' => Site\BlockLayout\CollectionDashboard::class,
            'discursiveCommunities' => Site\BlockLayout\DiscursiveCommunities::class,
            'spatialExploration' => Site\BlockLayout\SpatialExploration::class,
            'publications' => Site\BlockLayout\Publications::class,
            'youtube' => Site\BlockLayout\YouTube::class,
            'projectExplorer' => Site\BlockLayout\ProjectExplorer::class,
            'compareEntity' => Site\BlockLayout\CompareEntity::class,
            'compareGenres' => Site\BlockLayout\CompareGenres::class,
            'networkExplorer' => Site\BlockLayout\NetworkExplorer::class,
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
            Controller\Site\EmbedController::class => Controller\Site\EmbedController::class,
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
                    'dre-visualizations' => [
                        'type' => \Laminas\Router\Http\Literal::class,
                        'options' => [
                            'route' => '/dre-visualizations',
                            'defaults' => [
                                '__NAMESPACE__' => 'DreVisualizations\Controller\Admin',
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
            // Public embed endpoint (children of Omeka's `site` route, so the
            // current site + public theme are resolved from :site-slug). Renders
            // any viz block — or a single chart from a dashboard block — on a
            // bare, theme-following page for iframe embedding on other sites.
            'site' => [
                'child_routes' => [
                    'dre-embed' => [
                        'type' => \Laminas\Router\Http\Literal::class,
                        'options' => [
                            'route' => '/dre-embed',
                            'defaults' => [
                                'controller' => Controller\Site\EmbedController::class,
                                'action' => 'index',
                            ],
                        ],
                        'may_terminate' => true,
                        'child_routes' => [
                            'block' => [
                                'type' => \Laminas\Router\Http\Segment::class,
                                'options' => [
                                    'route' => '/:block',
                                    'constraints' => [
                                        'block' => '[a-z0-9-]+',
                                    ],
                                    'defaults' => [
                                        'action' => 'block',
                                    ],
                                ],
                                'may_terminate' => true,
                                'child_routes' => [
                                    // Single chart from a dashboard block, e.g.
                                    // /dre-embed/publications/coAuthorNetwork.
                                    'viz' => [
                                        'type' => \Laminas\Router\Http\Segment::class,
                                        'options' => [
                                            'route' => '/:viz',
                                            'constraints' => [
                                                'viz' => '[a-zA-Z0-9._-]+',
                                            ],
                                            'defaults' => [
                                                'action' => 'block',
                                            ],
                                        ],
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
                'label' => 'DRE Visualizations', // @translate
                'route' => 'admin/dre-visualizations/maintenance',
                'resource' => Controller\Admin\MaintenanceController::class,
                'class' => 'o-icon-chart',
                'pages' => [
                    [
                        'route' => 'admin/dre-visualizations/maintenance-regenerate',
                        'visible' => false,
                    ],
                ],
            ],
        ],
    ],
];
