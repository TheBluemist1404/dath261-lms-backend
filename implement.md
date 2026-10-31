Guard kiểm tra xem request có cần authentication/authorization?(guard), 
Nếu cần thì bắt phải làm xác thực quy định trong jwtStrategy(jwt.ts)
Xác thực xong thì file trả về user id và user role
Passport nhận object này và tự gán nó vào user nằm trong @Req

Ở controller lúc register và login đáng lẽ không cần phải xác thực và xác minh vì lucs đó chưa có accessToken(guard bỏ quả vì có @public()), 

register thực hiện quy trình xong chỉ trả về toàn bọ thông tin user dùng cho design frontend
register rồi thì phải đăng nhập lại. khi đăng nhập xong, nó cung cấp accessToken. Browser phải tự lưu token này và tự động gắn vào header mỗi khi tạo request sau này(Authorization: Bearer). 