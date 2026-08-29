import { useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { Button, Input, Switch, View } from '@tarojs/components'
import { Category } from '@/types'
import { createCategory, deleteCategory, getCategories, moveCategory, updateCategory } from '@/utils/categories'
import { getRecipes, updateRecipe } from '@/utils/recipes'
import './index.scss'

export default function CategoryManagePage() {
  const [categories, setCategories] = useState<Category[]>([])
  const [newName, setNewName] = useState('')
  const refresh = () => setCategories(getCategories())
  useDidShow(refresh)

  const add = () => {
    const name = newName.trim()
    if (!name) return Taro.showToast({ title: '请输入分类名称', icon: 'none' })
    if (categories.some((item) => item.name === name)) return Taro.showToast({ title: '分类名称已存在', icon: 'none' })
    createCategory(name); setNewName(''); refresh()
  }

  const remove = (category: Category) => {
    const recipes = getRecipes().filter((item) => item.categoryId === category.id)
    const fallback = categories.find((item) => item.name === '其他' && item.id !== category.id) || categories.find((item) => item.id !== category.id)
    if (!fallback) return Taro.showToast({ title: '至少保留一个分类', icon: 'none' })
    Taro.showModal({ title: '删除分类', content: recipes.length ? `该分类有 ${recipes.length} 道菜，删除后将移动到「${fallback.name}」。` : `确定删除「${category.name}」吗？`, confirmText: '删除', confirmColor: '#c14e48' }).then((result) => {
      if (!result.confirm) return
      recipes.forEach((recipe) => updateRecipe(recipe.id, { categoryId: fallback.id }))
      setCategories(deleteCategory(category.id))
    })
  }

  return (
    <View className='pk-page category-page'>
      <View className='pk-title'>分类管理</View><View className='pk-subtitle'>厨房左侧会按这里的顺序展示</View>
      <View className='category-add pk-card'><Input className='pk-input' value={newName} maxlength={12} placeholder='输入新分类名称' onInput={(event) => setNewName(event.detail.value)} /><Button className='pk-primary' onClick={add}>添加</Button></View>
      <View className='category-list'>{categories.map((category, index) => (
        <View key={category.id} className='category-card pk-card'>
          <Input className='category-name' value={category.name} maxlength={12} onBlur={(event) => { updateCategory(category.id, { name: event.detail.value }); refresh() }} />
          <View className='category-switch'><Switch checked={category.enabled} color='#4CAF50' onChange={(event) => { updateCategory(category.id, { enabled: event.detail.value }); refresh() }} /><View>{category.enabled ? '显示' : '隐藏'}</View></View>
          <View className='category-actions'><Button disabled={index === 0} onClick={() => setCategories(moveCategory(category.id, -1))}>上移</Button><Button disabled={index === categories.length - 1} onClick={() => setCategories(moveCategory(category.id, 1))}>下移</Button><Button className='danger' onClick={() => remove(category)}>删除</Button></View>
        </View>
      ))}</View>
    </View>
  )
}
