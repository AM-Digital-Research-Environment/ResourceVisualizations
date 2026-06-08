<?php
namespace DreVisualizations;

use Omeka\Module\AbstractModule;
use Omeka\Permissions\Acl;
use Laminas\EventManager\SharedEventManagerInterface;
use Laminas\Mvc\MvcEvent;
use DreVisualizations\View\Helper\DashboardAssets;

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
        $view->headLink()->appendStylesheet(
            $view->assetUrl('css/dre-visualizations.css', 'DreVisualizations')
        );
        // defer: keep the ECharts/MapLibre prelude off the critical render path.
        // Deferred scripts execute in append order, so dashboard-core (and the
        // chart chain a block appends after) still load first. The library URLs
        // come from the self-hosted vendor files (single source of truth:
        // DashboardAssets), resolved to same-origin module-asset URLs.
        $defer = ['defer' => true];
        $view->headScript()->appendFile(
            $view->assetUrl(DashboardAssets::ECHARTS_JS, 'DreVisualizations'), 'text/javascript', $defer
        );
        $view->headScript()->appendFile(
            $view->assetUrl(DashboardAssets::WORDCLOUD_JS, 'DreVisualizations'), 'text/javascript', $defer
        );
        $view->headLink()->appendStylesheet(
            $view->assetUrl(DashboardAssets::MAPLIBRE_CSS, 'DreVisualizations')
        );
        $view->headScript()->appendFile(
            $view->assetUrl(DashboardAssets::MAPLIBRE_JS, 'DreVisualizations'), 'text/javascript', $defer
        );
        $view->headScript()->appendFile(
            $view->assetUrl('js/dashboard-core.js', 'DreVisualizations'), 'text/javascript', $defer
        );
    }
}
