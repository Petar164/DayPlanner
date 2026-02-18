import type { PlannerApi } from '../../preload'

declare global {
  interface Window {
    planner: PlannerApi
  }
}

export {}
