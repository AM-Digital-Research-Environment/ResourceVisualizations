<?php
declare(strict_types=1);

namespace ResourceVisualizations\Form;

use Laminas\Form\Element\Csrf;
use Laminas\Form\Form;

/**
 * Minimal CSRF-only form for the admin maintenance page. The action (regenerate)
 * is determined by the route the form posts to, not by a payload field.
 */
class MaintenanceForm extends Form
{
    public function init(): void
    {
        $this->add([
            'name' => 'rv_maintenance_csrf',
            'type' => Csrf::class,
            'options' => [
                'csrf_options' => ['timeout' => 600],
            ],
        ]);
    }
}
