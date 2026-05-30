<?php
declare(strict_types=1);

namespace ResourceVisualizations\Controller\Admin;

use Laminas\Http\Response;
use Laminas\Mvc\Controller\AbstractActionController;
use Laminas\View\Model\ViewModel;
use Omeka\Stdlib\Message;
use ResourceVisualizations\Form\MaintenanceForm;
use ResourceVisualizations\Job\PrecomputeDashboards;

/**
 * Admin maintenance page for the ResourceVisualizations module.
 *
 *   indexAction       GET   /admin/resource-visualizations/maintenance
 *     Renders the page with a "Regenerate" button (CSRF-protected POST form).
 *
 *   regenerateAction  POST  /admin/resource-visualizations/maintenance/regenerate
 *     Dispatches ResourceVisualizations\Job\PrecomputeDashboards as an Omeka
 *     background job and flashes a link to its log at /admin/job/{id}/log.
 *
 * ACL: editor + site-admin + global-admin (granted in Module::onBootstrap).
 */
class MaintenanceController extends AbstractActionController
{
    public function indexAction(): ViewModel
    {
        return new ViewModel([
            'form' => $this->getForm(MaintenanceForm::class),
        ]);
    }

    public function regenerateAction(): Response
    {
        $request = $this->getRequest();
        if (!$request->isPost()) {
            return $this->redirect()->toRoute('admin/resource-visualizations/maintenance');
        }

        $form = $this->getForm(MaintenanceForm::class);
        $form->setData($request->getPost()->toArray());
        if (!$form->isValid()) {
            $this->messenger()->addError('Invalid form submission. Please reload the page and try again.'); // @translate
            return $this->redirect()->toRoute('admin/resource-visualizations/maintenance');
        }

        $job = $this->jobDispatcher()->dispatch(PrecomputeDashboards::class);

        $jobUrl = $this->url()->fromRoute('admin/id', ['controller' => 'job', 'id' => $job->getId()]);
        $message = new Message(
            'Dashboard regeneration queued — rebuilds every precomputed visualization (entities, overviews, communities). Track progress: %1$sjob #%2$d%3$s', // @translate
            sprintf('<a href="%s">', htmlspecialchars($jobUrl, ENT_QUOTES, 'UTF-8')),
            $job->getId(),
            '</a>'
        );
        $message->setEscapeHtml(false);
        $this->messenger()->addSuccess($message);

        return $this->redirect()->toRoute('admin/resource-visualizations/maintenance');
    }
}
