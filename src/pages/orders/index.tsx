import { useMemo, useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { Button, Image, Picker, Text, View } from '@tarojs/components'
import HeartMealIcon from '@/components/Icon'
import { Order, OrderStatus } from '@/types'
import { completeOrder, getOrders, reorder } from '@/utils/orders'
import './index.scss'

type Filter = 'all' | OrderStatus
const formatDate = (value: number) => {
  const date = new Date(value)
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
const formatTime = (value: number) => {
  const date = new Date(value)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [date, setDate] = useState('')
  const refresh = () => setOrders(getOrders())
  useDidShow(refresh)

  const filtered = useMemo(() => orders.filter((order) => filter === 'all' || order.status === filter)
    .filter((order) => !date || formatDate(order.createdAt) === date), [orders, filter, date])

  const handleReorder = (order: Order) => {
    reorder(order)
    Taro.showToast({ title: '已加入本次菜单', icon: 'success' })
    setTimeout(() => Taro.navigateTo({ url: '/pages/cart/index' }), 450)
  }

  return (
    <View className='pk-page orders-page'>
      <View className='orders-toolbar'>
        <View className='order-filters'>
          {([['all', '全部'], ['pending', '待做'], ['completed', '已完成']] as Array<[Filter, string]>).map(([value, label]) => <Button key={value} className={filter === value ? 'is-active' : ''} onClick={() => setFilter(value)}>{label}</Button>)}
        </View>
        <View className='date-filter'>
          <Picker mode='date' value={date || formatDate(Date.now())} onChange={(event) => setDate(String(event.detail.value))}><View className='date-picker'><HeartMealIcon name='calendar' size='sm' />{date || '日历'}</View></Picker>
          {date && <Button onClick={() => setDate('')}>清除</Button>}
        </View>
      </View>
      <View className='orders-summary'><View>一共记录了 <Text>{orders.length}</Text> 个订单</View><View className='summary-pill'>订单记录</View></View>

      {!filtered.length ? (
        <View className='order-empty'><View className='empty-divider' /><View className='pk-empty-title'>{orders.length ? '没有符合条件的订单' : '没有更多了'}</View><View className='empty-divider' />{!orders.length && <Button className='empty-go' onClick={() => Taro.switchTab({ url: '/pages/index/index' })}>去厨房点菜</Button>}</View>
      ) : (
        <View className='order-list'>{filtered.map((order) => (
          <View key={order.id} className='order-card pk-card'>
            <View className='order-top'><View><View className='order-date'>{formatDate(order.createdAt)}</View><View className='order-time'>{formatTime(order.createdAt)} · {order.items.reduce((sum, item) => sum + item.quantity, 0)} 件</View></View><View className={`status ${order.status}`}>{order.status === 'pending' ? '待做' : '已完成'}</View></View>
            <View className='order-items'>{order.items.map((item) => (
              <View key={`${order.id}_${item.recipeId}`} className='order-item'>
                {item.recipeImage ? <Image className='order-thumb' src={item.recipeImage} mode='aspectFill' /> : <View className='order-thumb pk-cover-fallback'>{item.recipeName.slice(0, 1)}</View>}
                <Text>{item.recipeName}</Text><Text>x{item.quantity}</Text>
              </View>
            ))}</View>
            {order.note && <View className='order-note'>备注：{order.note}</View>}
            <View className='order-actions'>{order.status === 'pending'
              ? <Button className='pk-primary' onClick={() => { try { completeOrder(order.id); refresh() } catch { Taro.showToast({ title: '订单状态保存失败', icon: 'none' }) } }}>完成</Button>
              : <Button className='pk-secondary' onClick={() => handleReorder(order)}>再来一单</Button>}
            </View>
          </View>
        ))}</View>
      )}
    </View>
  )
}
