<?php
declare(strict_types=1);

namespace DreVisualizations\Precompute;

use DreVisualizations\Precompute\Aggregators\SupportTrait;
use DreVisualizations\Precompute\Aggregators\BasicChartsTrait;
use DreVisualizations\Precompute\Aggregators\TemporalChartsTrait;
use DreVisualizations\Precompute\Aggregators\NetworkChartsTrait;
use DreVisualizations\Precompute\Aggregators\GeoChartsTrait;
use DreVisualizations\Precompute\Aggregators\HierarchyChartsTrait;
use DreVisualizations\Precompute\Aggregators\CommunityTrait;
use DreVisualizations\Precompute\Aggregators\PublicationChartsTrait;
use DreVisualizations\Precompute\Aggregators\OverviewChartsTrait;

// The builders are split into focused traits under Aggregators/. They are
// required explicitly (not just autoloaded) so this class works both under
// Omeka's PSR-4 autoloader and from the dependency-free test harness
// (tests/AggregatorsTest.php), which requires this file directly.
require_once __DIR__ . '/Aggregators/SupportTrait.php';
require_once __DIR__ . '/Aggregators/BasicChartsTrait.php';
require_once __DIR__ . '/Aggregators/TemporalChartsTrait.php';
require_once __DIR__ . '/Aggregators/NetworkChartsTrait.php';
require_once __DIR__ . '/Aggregators/GeoChartsTrait.php';
require_once __DIR__ . '/Aggregators/HierarchyChartsTrait.php';
require_once __DIR__ . '/Aggregators/CommunityTrait.php';
require_once __DIR__ . '/Aggregators/PublicationChartsTrait.php';
require_once __DIR__ . '/Aggregators/OverviewChartsTrait.php';

/**
 * Pure aggregation + chart-data builders for the dashboard precompute.
 *
 * Every method is static and operates on plain arrays (no Omeka or DB
 * dependencies), so the logic can be unit-tested in isolation. The in-memory
 * shapes are:
 *   - items:        [id => ['title'=>, 'template_id'=>, 'class_term'=>, 'class_label'=>]]
 *   - links:        [id => [[term, label, valueResourceId], ...]]
 *   - reverseLinks: [valueResourceId => [term => [ids]]]
 *   - childrenOf:   [parentId => [childIds]]
 *   - itemYear:     [id => 'YYYY']
 *   - temporal:     [id => [start, end]]
 *   - geo:          [id => ['name'=>, 'lat'=>, 'lon'=>, 'itemId'=>]]
 *
 * Builders return null when there is no data, so callers can skip empty keys
 * exactly as the JS orchestrator expects.
 *
 * The builders themselves live in focused traits under the Aggregators/
 * subdirectory (one concern each); this class composes them and owns the
 * shared constants they reference via `self::`. The public API is unchanged:
 * every method is still reached as `Aggregators::buildX(...)`.
 */
final class Aggregators
{
    use SupportTrait;
    use BasicChartsTrait;
    use TemporalChartsTrait;
    use NetworkChartsTrait;
    use GeoChartsTrait;
    use HierarchyChartsTrait;
    use CommunityTrait;
    use PublicationChartsTrait;
    use OverviewChartsTrait;

    /* ------------------------------------------------------------------ */
    /*  Shared constants (referenced by the trait methods via self::)      */
    /* ------------------------------------------------------------------ */

    public const TEMPLATE_PERSONS = 4;
    public const TEMPLATE_PROJECTS = 5;

    public const RADAR_AXES = [
        ['items', 'Items'],
        ['languages', 'Languages'],
        ['subjects', 'Subjects'],
        ['contributors', 'People'],
        ['types', 'Types'],
        ['span', 'Year span'],
    ];

    /** Resource template id for research projects (see Runner::TEMPLATE_PROJECTS). */
    private const TEMPLATE_PROJECT = 5;

    /**
     * Funding organisation title → canonical university label, mirroring the
     * amira dashboard's uniLabelMap. A project's home university is read from its
     * `frapo:isFundedBy` link (corroborated by the `UBT_`/`ULG_`/… `dre:id`
     * prefix). Unlisted funders fall through to their own title.
     */
    private const UNIVERSITY_LABELS = [
        'University of Bayreuth' => 'University of Bayreuth',
        'University of Lagos African Cluster Centre (LACC)' => 'University of Lagos',
        'University Joseph Ki-Zerbo' => 'Université Joseph Ki-Zerbo',
        'Universidade Federal da Bahia' => 'Federal University of Bahia',
        'CEAO Centro de Estudos Afro-Orientais' => 'Federal University of Bahia',
        'Rhodes University' => 'Rhodes University',
    ];
}
