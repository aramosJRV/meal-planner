import { dataUrlToBlob } from './media'

test('reads an imported photo, and treats a broken one as no photo', () => {
  expect(dataUrlToBlob('data:image/png;base64,AQID')?.size).toBe(3)
  expect(dataUrlToBlob('data:image/png;base64,AQID')?.type).toBe('image/png')
  expect(dataUrlToBlob('data:image/jpeg, image/webp;base64,AQID')).toBeUndefined()
  expect(dataUrlToBlob('data:image/png;base64,***')).toBeUndefined()
  expect(dataUrlToBlob('data:text/html;base64,AQID')).toBeUndefined()
})
