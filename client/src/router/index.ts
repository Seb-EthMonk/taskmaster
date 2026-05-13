import { createRouter, createWebHistory } from 'vue-router';
import ProjectsView from '../views/ProjectsView.vue';
import ProjectDetailView from '../views/ProjectDetailView.vue';
import AgentsView from '../views/AgentsView.vue';
import ActivityLogView from '../views/ActivityLogView.vue';
import SettingsView from '../views/SettingsView.vue';
import PortManagerView from '../views/PortManagerView.vue';
import ModelSettingsView from '../views/ModelSettingsView.vue';
import NotFoundView from '../views/NotFoundView.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      redirect: '/projects'
    },
    {
      path: '/projects',
      name: 'projects',
      component: ProjectsView
    },
    {
      path: '/projects/:id',
      name: 'project-detail',
      component: ProjectDetailView
    },
    {
      path: '/agents',
      name: 'agents',
      component: AgentsView
    },
    {
      path: '/logs',
      redirect: '/activity'
    },
    {
      path: '/activity',
      name: 'activity',
      component: ActivityLogView
    },
    {
      path: '/ports',
      name: 'ports',
      component: PortManagerView
    },
    {
      path: '/settings',
      name: 'settings',
      component: SettingsView
    },
    {
      path: '/model-settings',
      name: 'model-settings',
      component: ModelSettingsView
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: NotFoundView
    }
  ]
});

export default router;
