import "@testing-library/jest-dom/vitest"
import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"

// 本项目没开 globals，RTL 的自动清理挂不上去（它只在 afterEach 是全局时才注册），
// 不显式清就会让上一条用例渲染的 DOM 留在文档里，查询直接撞到多个元素。
afterEach(cleanup)
