import { useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { Button, Image, Textarea, View } from '@tarojs/components'
import { CartItemView } from '@/types'
import { calcTotalCount, clearCart, getCartView, removeCartItem, updateCartItemQuantity } from '@/utils/cart'
import { createOrder } from '@/utils/orders'
import './index.scss'

export default function CartPage() {
  const [items, setItems] = useState<CartItemView[]>([])
  const [note, setNote] = useState('')
  const refresh = () => setItems(getCartView().filter((item) => item.recipe))
  useDidShow(refresh)
  const total = calcTotalCount(items)

  const confirmClear = () => {
    Taro.showModal({ title: '清空本次菜单', content: '确定移除全部已选菜谱吗？', confirmText: '清空', confirmColor: '#c14e48' }).then((result) => {
      if (result.confirm) { clearCart(); refresh() }
    })
  }

  const submit = () => {
    try {
      const order = createOrder(note)
      if (!order) {
        Taro.showToast({ title: '请先选择菜谱', icon: 'none' })
        refresh()
        return
      }
      Taro.showToast({ title: '订单已生成，开始准备吧', icon: 'success' })
      setTimeout(() => Taro.switchTab({ url: '/pages/orders/index' }), 500)
    } catch {
      Taro.showToast({ title: '订单保存失败，本次菜单已保留', icon: 'none' })
      refresh()
    }
  }

  return (
    <View className='pk-page cart-page'>
      <View className='cart-head'><View><View className='pk-title'>本次菜单</View><View className='pk-subtitle'>共选了 {total} 件</View></View>{items.length > 0 && <Button className='clear-cart' onClick={confirmClear}>清空</Button>}</View>
      {!items.length ? (
        <View className='pk-empty pk-card cart-empty'><View className='pk-empty-title'>还没有选择菜谱</View><View className='pk-empty-desc'>回厨房点几道想做的菜吧</View><Button className='pk-primary empty-go' onClick={() => Taro.switchTab({ url: '/pages/index/index' })}>去厨房</Button></View>
      ) : (
        <>
          <View className='cart-list'>
            {items.map((item) => item.recipe && (
              <View key={item.recipeId} className='cart-line pk-card'>
                {item.recipe.coverImage ? <Image className='cart-cover' src={item.recipe.coverImage} mode='aspectFill' /> : <View className='cart-cover pk-cover-fallback'>{item.recipe.name.slice(0, 1)}</View>}
                <View className='cart-line-main'>
                  <View className='cart-name'>{item.recipe.name}</View>
                  <Button className='remove-line' onClick={() => { removeCartItem(item.recipeId); refresh() }}>删除</Button>
                  <View className='line-stepper'>
                    <Button onClick={() => { updateCartItemQuantity(item.recipeId, -1); refresh() }}>−</Button>
                    <View>{item.quantity}</View>
                    <Button className='is-plus' onClick={() => { updateCartItemQuantity(item.recipeId, 1); refresh() }}>+</Button>
                  </View>
                </View>
              </View>
            ))}
          </View>
          <View className='note-card pk-card'><View className='section-label'>本次备注</View><Textarea className='pk-textarea' maxlength={200} value={note} placeholder='例如：少辣、先做汤、周日晚餐' onInput={(event) => setNote(event.detail.value)} /></View>
          <View className='cart-submit-bar'><View><View className='submit-label'>本次共</View><View className='submit-count'>{total} 件</View></View><Button className='pk-primary submit-order' onClick={submit}>生成订单</Button></View>
        </>
      )}
    </View>
  )
}
