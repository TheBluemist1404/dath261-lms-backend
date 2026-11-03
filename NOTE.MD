**Cách hoạt động** của các file
*dto.ts*: 
- Dùng để định nghĩa cấu trúc của 1 object sẽ dùng để làm tham số cho POST request gửi lên để tạo/cập nhật thông tin
- Có dùng validation pipe là các hàm của thư viện class-validator dùng để validate các thông tin nhập vào cho các attribute của DTO objects

*courses.controller.ts*: Là endpoint bên phía server dùng để nhận request api từ client, chịu trách nhiệm phân loại api để gọi service phù hợp cho từng loại

*courses.service.ts*: Dùng để dịnh nghĩa logic backend để xử lý cho từng loại api request cụ thể

*courses.module.ts*: Dùng để cung cấp kết nối controller và service lại với nhau đồng thời cung cấp thêm module bên ngoài vào nữa để sử dụng code và thư viện bên ngoài mà không phải viết lại code

>> Chính vì cấu trúc của 1 web app cần nhận request và xử lý request gọi service nên mới cần có module để tổ chức, đó là lý do mà cần có 3 loại file cơ bản này


**các function của prisma.service**:
```ts
const course = await this.prismaService.course.findUnique({
  where: {
    id: 'course123',
  },
});
```
- findUnique: Tìm khóa primary, nếu ko có thì throw null
- findUniqueOrThrow() — tìm hoặc báo lỗi
- findFirst() — tìm bản ghi đầu tiên thỏa điều kiện
- findMany() - lấy danh sách bản ghi
```ts
const courses = await this.prismaService.course.findMany({
  where: {
    title: {
      contains: 'Java',
    },
  },
  orderBy: {
    title: 'asc',
  },
  skip: 0,
  take: 10,
});
```
- create() — tạo một bản ghi
```ts
const block = await this.prismaService.courseBlock.create({
  data: {
    courseId: 'course123',
    type: 'TEXT',
    title: 'Giới thiệu',
    position: 1,
    content: {
      text: 'Chào mừng đến khóa học!',
    },
  },
});
```
- createMany() — tạo nhiều bản ghi(data là mảng [])
- update() — cập nhật một bản ghi(có where và data)
- updateMany() - cập nhật nhiều
- upsert() — có thì cập nhật, chưa có thì tạo(where, update, create)
- delete() — xóa một bản ghi
- deleteMany() — xóa nhiều bản ghi
- select — chỉ lấy những trường cần thiết
```ts
const course = await this.prismaService.course.findUnique({
  where: { id: 'course123' },
  select: {
    id: true,
    title: true,
  },
});
```
