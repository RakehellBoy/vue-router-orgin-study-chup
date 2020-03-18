import View from './components/view'
import Link from './components/link'

export let _Vue
/** 提供Vue.use 安装vue-router的install方法 */
export function install (Vue) {
  if (install.installed && _Vue === Vue) return  // 防止重复安装vue-router插件(其实vue.use方法也做了防重处理)
  install.installed = true

  _Vue = Vue

  const isDef = v => v !== undefined

  const registerInstance = (vm, callVal) => {
    let i = vm.$options._parentVnode
    if (isDef(i) && isDef(i = i.data) && isDef(i = i.registerRouteInstance)) {
      i(vm, callVal)
    }
  }

  Vue.mixin({
    beforeCreate () {  // Vue混入全局beforeCreate方法， vue实例对象(组件)初始化前都会执行该方法
      if (isDef(this.$options.router)) {
        this._routerRoot = this // new Vue({ xxx }) 创建的根对象
        this._router = this.$options.router 
        this._router.init(this) // VueRouter 实例对象的init方法调用(只会调用一次, 因为只有最外层new Vue 中router属性)
        Vue.util.defineReactive(this, '_route', this._router.history.current)
      } else {
        this._routerRoot = (this.$parent && this.$parent._routerRoot) || this  // 向父组件寻找，由于对象赋值，所以所有_routerRoot指向相同的对象地址
      }
      registerInstance(this, this)
    },
    destroyed () { // vue实例对象(组件) 注销时都会执行该方法
      registerInstance(this)
    }
  })

  Object.defineProperty(Vue.prototype, '$router', { // Vue原型链上添加$router属性
    get () { return this._routerRoot._router }
  })

  Object.defineProperty(Vue.prototype, '$route', { // Vue原型链上添加$route属性
    get () { return this._routerRoot._route }
  })

  Vue.component('RouterView', View) // 注册全局 router-view 组件
  Vue.component('RouterLink', Link) // 注册全局 router-link 组件

  const strats = Vue.config.optionMergeStrategies // 获取Vue options合并策略方法
  // 即新增三个router合拼策略，和vue created合拼策略一样(即 mergeHook)
  strats.beforeRouteEnter = strats.beforeRouteLeave = strats.beforeRouteUpdate = strats.created
}
