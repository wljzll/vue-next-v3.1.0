import { effect, ReactiveEffect, trigger, track } from './effect'
import { TriggerOpTypes, TrackOpTypes } from './operations'
import { Ref } from './ref'
import { isFunction, NOOP } from '@vue/shared'
import { ReactiveFlags, toRaw } from './reactive'

// 情况一：
//  let age = ref(1);
//  let myAge = computed(()=> {
//      return age.value + 17
//  })
//  console.log(myAge.value); 
//  age.value = 2;
//  console.log(myAge.value);



// 情况二：
//  let res = effect(()=> {
//      console.log(myAge.value, '重新执行effect');
//  })
//  age.value = 2

/**
 * computed的工作流程：
 * 1) 用户声明一个computed - computed(() => { return age + 1})
 *    1.1) 创建一个computed实例;
 *    1.2) 创建computed实例过程中, 在ComputedRefImpl类中,创建一个effect,并且默认不执行. 
 *    1.3) 实例的get()方法 - 执行1.2中创建的effect, 让这个computed实例收集当前可能存在的effect
 *    1.4) 实例的set()方法 - 调用用户传入的set()或者默认的set()将新值传入
 * 
 * 2) 用户取值 - console.log(myAge.value)
 *    2.1) 调用computed实例的get()方法 => 判断_dirty是否为true,脏的才去重新执行effect => (假定是第一次执行)执行effect =>
 *         effect中执行computed的get()函数 => 对computed中的响应式数据取值,触发这些数据的get()方法,track当前effect =>
 *         至此,computed中的响应式数据收集了computed中创建的effect
 * 3) 当computed中依赖的数据发生变化 - age.value = 10
 *    3.1) 触发对应数据的set()函数 => trigger effect => 执行computed创建的effect => 将_dirty置为true
 * 
 * 4) 用户再次取值computed - console.log(myAge)
 *    4.1) _dirty为true,重新执行effect,获取最新的结果
 * 
 * 5) 当用户将computed放在effect中使用时：effect(()=> {console.log(myAge)})
 *    5.1) 我们要求当computed依赖的数据发生变化时也就是computed发生了变化，只不过computed只有当我们重新取值时才会更新,这个effect也要重新执行
 *    5.2) 在computed的get()函数中，我们tarck了这个effect
 *    5.3) 当computed依赖的数据发生变化时,会trigger computed的effect 在scheduler中trigger了使用computed的effect
 *    5.4) 这个effect对computed重新取值
 */
export interface ComputedRef<T = any> extends WritableComputedRef<T> {
  readonly value: T
}

export interface WritableComputedRef<T> extends Ref<T> {
  readonly effect: ReactiveEffect<T>
}

export type ComputedGetter<T> = (ctx?: any) => T
export type ComputedSetter<T> = (v: T) => void

export interface WritableComputedOptions<T> {
  get: ComputedGetter<T>
  set: ComputedSetter<T>
}

class ComputedRefImpl<T> {
  private _value!: T
  private _dirty = true

  public readonly effect: ReactiveEffect<T>

  public readonly __v_isRef = true;
  public readonly [ReactiveFlags.IS_READONLY]: boolean

  constructor(
    getter: ComputedGetter<T>,
    private readonly _setter: ComputedSetter<T>,
    isReadonly: boolean
  ) {
    this.effect = effect(getter, {
      lazy: true,
      scheduler: () => {
        if (!this._dirty) {
          this._dirty = true
          trigger(toRaw(this), TriggerOpTypes.SET, 'value')
        }
      }
    })

    this[ReactiveFlags.IS_READONLY] = isReadonly
  }

  get value() {
    // the computed ref may get wrapped by other proxies e.g. readonly() #3376
    const self = toRaw(this)
    if (self._dirty) {
      self._value = this.effect()
      self._dirty = false
    }
    // 如果在effect中使用了computed 要让computed收集这个effect
    track(self, TrackOpTypes.GET, 'value')
    return self._value
  }

  set value(newValue: T) {
    this._setter(newValue)
  }
}

export function computed<T>(getter: ComputedGetter<T>): ComputedRef<T>
export function computed<T>(
  options: WritableComputedOptions<T>
): WritableComputedRef<T>
export function computed<T>(
  getterOrOptions: ComputedGetter<T> | WritableComputedOptions<T>
) {
  let getter: ComputedGetter<T>
  let setter: ComputedSetter<T>

  if (isFunction(getterOrOptions)) {
    getter = getterOrOptions
    setter = __DEV__
      ? () => {
          console.warn('Write operation failed: computed value is readonly')
        }
      : NOOP
  } else {
    getter = getterOrOptions.get
    setter = getterOrOptions.set
  }

  return new ComputedRefImpl(
    getter,
    setter,
    isFunction(getterOrOptions) || !getterOrOptions.set
  ) as any
}
