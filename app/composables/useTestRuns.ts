import type { TestRunRequest, TestRunResult, TestRunResponse } from '#shared/types/runs'

// =============================================================================
//  useTestRuns — launch a backtest from the Test Builder (§58.9 Slice 3).
//
//  Unlike the read-only composables, a launch MUST surface its error: the page
//  shows why a run could not start (validation 400 / engine 502) instead of an
//  empty state, so this helper throws and lets the caller notify.
// =============================================================================

export const useTestRuns = () => {
  async function backtest(input: TestRunRequest): Promise<TestRunResult> {
    const res = await $fetch<TestRunResponse>('/api/v1/runs', {
      method: 'POST',
      body: input
    })
    if (!res.data) throw new Error('testRuns.empty')
    return res.data
  }

  return { backtest }
}
