<?php
namespace DreVisualizations\Controller\Site;

use Laminas\Mvc\Controller\AbstractActionController;
use Laminas\View\Model\ViewModel;

/**
 * Standalone embed endpoint for the DRE Visualizations page blocks.
 *
 * Every embeddable page block here is zero-configuration: it only needs a site
 * context (current site + base path) to render — the block templates never read
 * `$block`, they fetch their precomputed JSON from the module's same-origin
 * asset/data/ directory. That lets us render any single block (or a single chart
 * from a dashboard block) on its own bare page, suitable for dropping into a
 * third-party site via an `<iframe>`. Because the iframe loads from this same
 * origin, the data fetches, the module CSS, the active theme's compiled
 * stylesheet (its design tokens + fonts), and the lazy ECharts/MapLibre loaders
 * all resolve exactly as on a normal site page — no CORS, no cross-origin data
 * copy, no stylesheet collision with the host page.
 *
 * Routes (children of Omeka's `site` route, so `site-slug` is inherited and the
 * current site / public theme are set):
 *
 *   /s/:site-slug/dre-embed                 → indexAction  (snippet gallery)
 *   /s/:site-slug/dre-embed/:block          → blockAction  (one bare block)
 *   /s/:site-slug/dre-embed/:block/:viz      → blockAction  (one chart, dashboards)
 *
 * Query params honoured by blockAction (all optional):
 *   ?theme=dark         opt into dark mode (embeds render light by default)
 *   ?primary=RRGGBB     override the brand seed (else the site's primary_color)
 */
class EmbedController extends AbstractActionController
{
    /**
     * Whitelist of embeddable page blocks.
     *
     * The key is the URL slug (route-constrained to [a-z0-9-]+); it also doubles
     * as the directory-traversal guard for the rendered partial, since only the
     * `template` value here — never user input — is fed to partial().
     *
     *   label    Human label for the gallery card and <title>.
     *   template The `common/block-layout/<template>` partial rendered verbatim
     *            for a whole-block embed (identical to the on-page block).
     *   kind     'dashboard' — built by dashboard.js from a layout of chart keys,
     *            so a single chart can be embedded via the :viz segment;
     *            'widget' — a single self-contained controller (map / network /
     *            compare / explorer), embeddable only as a whole.
     *   itemId   (dashboards) the precomputed JSON id under asset/data/item-dashboards/.
     *   layout   (dashboards) the RV.LAYOUTS key whose chart-key order drives both
     *            the on-page render and the gallery's single-chart enumeration.
     *
     * The slug is also stamped as `data-embed-slug` on the block's own template so
     * the on-page "copy embed code" buttons (dashboard-core.js) can build the embed
     * URL; keep the two in sync when adding a block.
     *
     * @var array<string, array{label:string, template:string, kind:string, itemId?:string, layout?:string}>
     */
    const BLOCKS = [
        'collection-overview' => [
            'label' => 'Collection Overview', // @translate
            'template' => 'collection-overview',
            'kind' => 'dashboard',
            'itemId' => 'collection-overview',
            'layout' => 'collectionOverview',
        ],
        'collection-dashboard' => [
            'label' => 'Collection Dashboard', // @translate
            'template' => 'collection-dashboard',
            'kind' => 'dashboard',
            'itemId' => 'collection-overview',
            'layout' => 'section',
        ],
        'publications' => [
            'label' => 'Publications', // @translate
            'template' => 'publications',
            'kind' => 'dashboard',
            'itemId' => 'publications',
            'layout' => 'publications',
        ],
        'youtube' => [
            'label' => 'YouTube', // @translate
            'template' => 'youtube',
            'kind' => 'dashboard',
            'itemId' => 'youtube',
            'layout' => 'youtube',
        ],
        'discursive-communities' => [
            'label' => 'Discursive Communities', // @translate
            'template' => 'discursive-communities',
            'kind' => 'widget',
        ],
        'spatial-exploration' => [
            'label' => 'Spatial Exploration', // @translate
            'template' => 'spatial-exploration',
            'kind' => 'widget',
        ],
        'network-explorer' => [
            'label' => 'Network Explorer', // @translate
            'template' => 'network-explorer',
            'kind' => 'widget',
        ],
        'compare-entity' => [
            'label' => 'Compare (any entity)', // @translate
            'template' => 'compare-entity',
            'kind' => 'widget',
        ],
        'compare-genres' => [
            'label' => 'Compare Genres', // @translate
            'template' => 'compare-genres',
            'kind' => 'widget',
        ],
        'project-explorer' => [
            'label' => 'Project Explorer', // @translate
            'template' => 'project-explorer',
            'kind' => 'widget',
        ],
        'whats-new' => [
            'label' => "What's New", // @translate
            'template' => 'whats-new',
            'kind' => 'widget',
        ],
    ];

    /**
     * Snippet gallery: lists every embeddable block with a live preview and a
     * copy-paste `<iframe>` + auto-resize snippet. Dashboard blocks also expose
     * their individual charts (enumerated client-side from RV.LAYOUTS so the menu
     * never drifts from the actual layouts/labels).
     */
    public function indexAction()
    {
        $this->layout()->setTemplate('dre-visualizations/layout/embed');
        $this->layout()->setVariable('isGallery', true);

        $view = new ViewModel([
            'blocks' => self::BLOCKS,
            'siteSlug' => $this->currentSite()->slug(),
        ]);
        $view->setTemplate('dre-visualizations/embed/index');
        return $view;
    }

    /**
     * Render one page block — or one chart from a dashboard block — on a bare
     * page for iframe embedding.
     */
    public function blockAction()
    {
        $slug = (string) $this->params()->fromRoute('block', '');
        if (!isset(self::BLOCKS[$slug])) {
            return $this->notFound();
        }
        $info = self::BLOCKS[$slug];

        // A :viz segment requests a single chart; only the dashboard blocks
        // (rendered by dashboard.js from a chart-key layout) support it.
        $viz = (string) $this->params()->fromRoute('viz', '');
        if ($viz !== '' && ($info['kind'] ?? '') !== 'dashboard') {
            return $this->notFound();
        }

        // Colour mode. Embeds render light by default (the layout stamps
        // data-theme=light); ?theme=dark opts into dark. Pass the raw value
        // through — the layout treats anything but 'dark' as light.
        $theme = strtolower((string) $this->params()->fromQuery('theme', ''));
        if ($theme !== 'light' && $theme !== 'dark') {
            $theme = '';
        }

        // Brand seed override: accept a bare or #-prefixed 3/6/8-digit hex. The
        // DRE theme derives every accent/hover/focus tint from --primary-base via
        // OKLCH colour-mixing, so this single value re-tints the whole embed.
        $primary = (string) $this->params()->fromQuery('primary', '');
        if ($primary !== '' && preg_match('/^#?[0-9a-fA-F]{3}([0-9a-fA-F]{3}([0-9a-fA-F]{2})?)?$/', $primary)) {
            $primary = '#' . ltrim($primary, '#');
        } else {
            $primary = '';
        }

        $title = $info['label'];
        if ($viz !== '') {
            $title .= ' — ' . $viz;
        }

        $this->layout()->setTemplate('dre-visualizations/layout/embed');
        $this->layout()->setVariable('embedTheme', $theme);
        $this->layout()->setVariable('embedPrimary', $primary);
        $this->layout()->setVariable('embedTitle', $title);

        $view = new ViewModel([
            'slug' => $slug,
            'info' => $info,
            'viz' => $viz,
        ]);
        $view->setTemplate('dre-visualizations/embed/block');
        return $view;
    }

    /**
     * A bare 404 on the embed layout, so a mistyped slug still renders inside the
     * frame instead of bleeding the site's themed error page into the iframe.
     */
    protected function notFound()
    {
        $this->getResponse()->setStatusCode(404);
        $this->layout()->setTemplate('dre-visualizations/layout/embed');
        $this->layout()->setVariable('isGallery', true);
        $this->layout()->setVariable('embedTitle', 'Not found'); // @translate
        $view = new ViewModel();
        $view->setTemplate('dre-visualizations/embed/not-found');
        return $view;
    }
}
