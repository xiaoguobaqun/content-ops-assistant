var express = require('express');
var indexRouter = require('./routes/index');
const path = require('path');
var app = express();
 //设置跨域访问
 app.all('*',function(req,res,next) {
  res.header("Access-Control-Allow-Origin","*");
  res.header('Access-Control-Allow-Methods','PUT,GET,POST,DELETE,OPTIONS');
  // 注意：重复调用 res.header 同名头是覆盖而非追加，
  // 自定义令牌头必须和 Content-Type 写在同一次调用里
  res.header("Access-Control-Allow-Headers","Content-Type, X-Matrix-Token");
  next();
});
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use('/', indexRouter);
app.use(express.static(path.resolve(__dirname,'./public') , {dotfiles: 'allow'})); 
app.use(function(req, res, next) {
  res.json({ error: 404 })
});
app.use(function(err, req, res, next) {
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};
  res.status(err.status || 500);
  res.json({ error: err })
});

export default app
