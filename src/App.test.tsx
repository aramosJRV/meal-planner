import { render, screen } from '@testing-library/react'
import App from './App'

test('renders the home screen heading', () => {
  render(<App />)
  expect(screen.getByRole('heading', { name: 'Meal Planner' })).toBeInTheDocument()
})
