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

        // The embed endpoint is served into third-party pages via <iframe>, so it
        // must be reachable by everyone — including anonymous visitors. Grant the
        // null (all) role access to the site-facing embed controller only; the
        // public site route itself still scopes it to a published site.
        $acl->allow(null, [Controller\Site\EmbedController::class]);

        // Allow that widget to be framed cross-origin (slides, project sites, …):
        // on the /dre-embed routes only, swap the site's X-Frame-Options for a
        // permissive CSP frame-ancestors. See relaxEmbedFraming().
        $event->getApplication()->getEventManager()->attach(
            MvcEvent::EVENT_FINISH,
            [$this, 'relaxEmbedFraming'],
            100
        );
    }

    /**
     * Replace X-Frame-Options with a permissive CSP frame-ancestors on the
     * /dre-embed routes, so the public, read-only widget can be framed on other
     * origins. X-Frame-Options only understands DENY / SAMEORIGIN — it cannot
     * allowlist origins — which is why the CSP frame-ancestors form is needed.
     *
     * Effective only when the header is set by Omeka/PHP. If the reverse proxy
     * (nginx) adds `X-Frame-Options ... always`, that overrides PHP and must be
     * relaxed for the /dre-embed path there too — but this CSP is then already in
     * place, so only the X-Frame-Options removal is left to do at the proxy.
     */
    public function relaxEmbedFraming(MvcEvent $event)
    {
        $match = $event->getRouteMatch();
        if (!$match || strpos((string) $match->getMatchedRouteName(), 'site/dre-embed') !== 0) {
            return;
        }
        $response = $event->getResponse();
        if (!$response instanceof \Laminas\Http\Response) {
            return;
        }
        $headers = $response->getHeaders();
        $xfo = $headers->get('X-Frame-Options');
        if ($xfo) {
            foreach (($xfo instanceof \Traversable ? iterator_to_array($xfo) : [$xfo]) as $header) {
                $headers->removeHeader($header);
            }
        }
        // Public read-only widget — any parent may frame it. Swap in an explicit
        // allowlist (e.g. "frame-ancestors 'self' https://slides.example") here if
        // embedding should ever be restricted.
        $headers->addHeaderLine('Content-Security-Policy', 'frame-ancestors *');
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
        $asset = function ($path) use ($view) {
            return $view->assetUrl($path, 'DreVisualizations');
        };

        // dre-visualizations.css styles the (below-the-fold) viz blocks and their
        // loading spinner. Inject it non-render-blocking via the media="print"→
        // "all" swap so it never sits on the item page's critical render path.
        // The viz blocks need JS to render anyway, so a JS-gated stylesheet costs
        // no real no-script fallback.
        $cssHref = json_encode($asset('css/dre-visualizations.css'), JSON_UNESCAPED_SLASHES);
        $view->headScript()->appendScript(
            '(function(){var l=document.createElement("link");l.rel="stylesheet";'
            . 'l.media="print";l.href=' . $cssHref . ';'
            . 'l.onload=function(){this.onload=null;this.media="all";};'
            . 'document.head.appendChild(l);})();'
        );

        // Hand the heavy library URLs to the front end instead of eager-loading
        // ~660 KiB of ECharts + MapLibre on every item/item-set page. The viz
        // controllers (dashboard.js, knowledge-graph.js, sibling-sparkline.js)
        // call ns.ensureLibs() to pull them in only when a block actually needs
        // to render — on scroll into view, or once an async block resolves as
        // applicable. Mirrors the lazy 'dashboard' surface in DashboardAssets.
        $view->headScript()->appendScript('window.RV_LIBS=window.RV_LIBS||' . json_encode([
            'echarts'     => $asset(DashboardAssets::ECHARTS_JS),
            'wordcloud'   => $asset(DashboardAssets::WORDCLOUD_JS),
            'maplibre'    => $asset(DashboardAssets::MAPLIBRE_JS),
            'maplibreCss' => $asset(DashboardAssets::MAPLIBRE_CSS),
        ], JSON_UNESCAPED_SLASHES) . ';');

        // dashboard-core.js defines ns.ensureLibs + the shared chart helpers;
        // deferred so it never blocks first paint, and it pulls in no heavy
        // library on its own. Blocks append their builder chain (and controller)
        // after it via the DashboardAssets helper; deferred scripts run in append
        // order, so the registry is built before any controller's init() fires.
        $view->headScript()->appendFile(
            $asset('js/dashboard-core.js'), 'text/javascript', ['defer' => true]
        );
    }
}
