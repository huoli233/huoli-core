// 出站排一条队：同一实例的发送、撤回、连发按调用顺序走，几串气泡不会交织

import { AsyncLocalStorage } from 'node:async_hooks'

/** 一条出站队列 */
export interface SendChain {
  /**
   * 排到队尾，等前面那次做完再做
   * @param task - 这一次要做的出站动作
   * @returns 这一次的结果
   */
  run<T>(task: () => Promise<T>): Promise<T>
}

/**
 * 建一条出站队列
 * @returns 队列
 */
export function createSendChain(): SendChain {
  let tail: Promise<unknown> = Promise.resolve()
  // 已经在队里再做一次就会自己等自己，用当前这段执行认出来
  const alreadyQueued = new AsyncLocalStorage<true>()
  return {
    run(task) {
      if (alreadyQueued.getStore() === true) return task()
      const run = tail.then(() => alreadyQueued.run(true, task))
      // 前一次失败不能卡住后面：队尾只留这一轮结果，不留它的拒绝
      tail = run.then(() => undefined, () => undefined)
      return run
    },
  }
}
