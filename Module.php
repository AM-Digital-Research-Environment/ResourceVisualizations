<?php
namespace ResourceVisualizations;

use Omeka\Module\AbstractModule;
use Omeka\Permissions\Acl;
use Laminas\EventManager\SharedEventManagerInterface;
use Laminas\Mvc\MvcEvent;

class Module extends AbstractModule
{
    public function getConfig()
    {
        return include __DIR__ . '/config/module.config.php';
    }

    public function onBootstrap(MvcEvent $event)
    {
        parent::onBootstrap($event);

        // Let editors and admins reach the maintenance / regenerate page.
        // The /admin/ parent route already enforces authentication; this just
        // narrows which logged-in roles pass the controller ACL check.
        $acl = $event->getApplication()->getServiceManager()->get('Omeka\Acl');
        $acl->allow(
            [Acl::ROLE_EDITOR, Acl::ROLE_SITE_ADMIN, Acl::ROLE_GLOBAL_ADMIN],
            [Controller\Admin\MaintenanceController::class]
        );
    }

    public function attachListeners(SharedEventManagerInterface $sharedEventManager)
    {
        $sharedEventManager->attach(
            'Omeka\Controller\Site\Item',
            'view.show.before',
            [$this, 'addAssets']
        );
        $sharedEventManager->attach(
            'Omeka\Controller\Site\ItemSet',
            'view.show.before',
            [$this, 'addAssets']
        );
    }

    public function addAssets($event)
    {
        $view = $event->getTarget();
        // Warm the CDN connection; the libraries below are deferred.
        $view->headLink(['rel' => 'preconnect', 'href' => 'https://cdn.jsdelivr.net']);
        $view->headLink()->appendStylesheet(
            $view->assetUrl('css/resource-visualizations.css', 'ResourceVisualizations')
        );
        // defer: keep the ~650 KiB ECharts/MapLibre prelude off the critical
        // render path. Deferred scripts execute in append order, so dashboard-
        // core (and the chart chain a block appends after) still load first.
        $defer = ['defer' => true];
        $view->headScript()->appendFile(
            'https://cdn.jsdelivr.net/npm/echarts@6/dist/echarts.min.js', 'text/javascript', $defer
        );
        $view->headScript()->appendFile(
            'https://cdn.jsdelivr.net/npm/echarts-wordcloud@2/dist/echarts-wordcloud.min.js', 'text/javascript', $defer
        );
        $view->headLink()->appendStylesheet(
            'https://cdn.jsdelivr.net/npm/maplibre-gl@5/dist/maplibre-gl.css'
        );
        $view->headScript()->appendFile(
            'https://cdn.jsdelivr.net/npm/maplibre-gl@5/dist/maplibre-gl.js', 'text/javascript', $defer
        );
        $view->headScript()->appendFile(
            $view->assetUrl('js/dashboard-core.js', 'ResourceVisualizations'), 'text/javascript', $defer
        );
    }
}
