import { Button, Form, Input, message } from "antd";
import { editUserUsingPost, getLoginUserUsingGet } from "@/api/userController";
import React, { useEffect } from "react";
import {useDispatch} from "react-redux";
import {AppDispatch} from "@/stores";
import {setLoginUser} from "@/stores/loginUser";

interface Props {
  user: API.LoginUserVO;
}

/**
 * 用户信息编辑表单
 * @constructor
 */
const UserInfoEditForm = (props: Props) => {
  const dispatch = useDispatch<AppDispatch>();

  const [form] = Form.useForm();
  const { user } = props;
  useEffect(() => {
    form.setFieldsValue(user);
  }, [form, user]);

  /**
   * 提交
   *
   * @param values
   */
  const doSubmit = async (values: API.UserEditRequest) => {
    const hide = message.loading("正在操作");
    try {
      await editUserUsingPost({...values, userName: values.userName?.trim()});
      const res = await getLoginUserUsingGet();
      if (res.data) dispatch(setLoginUser(res.data));
      hide();
      message.success("操作成功");
    } catch (error: any) {
      hide();
      message.error("操作失败，" + error.message);
    }
  };

  return (
    <Form
      form={form}
      style={{ marginTop: 24, maxWidth: 480 }}
      labelCol={{ span: 4 }}
      labelAlign="left"
      onFinish={doSubmit}
    >
      <Form.Item
        label="昵称"
        name="userName"
        extra="用于页面显示，不会修改登录账号"
        rules={[{ required: true, whitespace: true, message: "请输入昵称" }, { max: 32, message: "昵称最多 32 个字符" }]}
      >
        <Input placeholder="请输入昵称" maxLength={32} />
      </Form.Item>
      <Form.Item label="手机号" name="phoneNumber">
        <Input placeholder="请输入手机号" />
      </Form.Item>
      <Form.Item label="邮箱" name="email">
        <Input placeholder="请输入邮箱" />
      </Form.Item>
      <Form.Item label="年级" name="grade">
        <Input placeholder="请输入年级" />
      </Form.Item>
      <Form.Item label="工作经验" name="workExperience">
        <Input placeholder="请输入工作经验" />
      </Form.Item>
      <Form.Item label="擅长方向" name="expertiseDirection">
        <Input placeholder="请输入擅长方向" />
      </Form.Item>
      <Form.Item>
        <Button style={{ width: 180 }} type="primary" htmlType="submit">
          提交
        </Button>
      </Form.Item>
    </Form>
  );
};

export default UserInfoEditForm;
